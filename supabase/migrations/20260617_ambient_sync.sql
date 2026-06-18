-- ─────────────────────────────────────────────────────────────────────────────
-- Ambient Sync — comment thread intelligence layer
--
-- Six new tables that form the backbone of ambient sync:
--
--   comment_threads   — one row per "conversation" regardless of source tool
--   thread_comments   — individual messages/replies inside a thread
--   thread_decisions  — structured decisions extracted from threads by AI
--   thread_summaries  — AI-generated summary produced when a thread resolves
--   sync_events       — raw incoming webhook payloads + processing log
--
-- Design principles:
--   • workspace_id on every table — RLS filters on it, no exceptions
--   • source + source_thread_id is the dedup key for webhook idempotency
--   • soft-delete via deleted_at/resolved_at — hard deletes only via CASCADE
--   • jsonb raw_payload in sync_events preserves the full webhook body for
--     replayability — if the processor changes, we can re-run old events
--   • confidence_score on thread_decisions lets the UI surface low-confidence
--     extractions for human review before they're promoted to decisions
-- ─────────────────────────────────────────────────────────────────────────────


-- ── 1. comment_threads ────────────────────────────────────────────────────────
-- One row per logical conversation thread, normalised across Figma/Slack/Jira/Notion.
-- source_thread_id is the external ID (Figma comment ID, Slack thread ts, etc.)
-- source_url is a deep-link back into the originating tool.

CREATE TABLE IF NOT EXISTS comment_threads (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     uuid        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id       uuid        REFERENCES projects(id) ON DELETE SET NULL,

  -- Which tool this thread came from and how to find it there
  source           text        NOT NULL CHECK (source IN ('figma', 'slack', 'jira', 'notion')),
  source_thread_id text        NOT NULL,
  source_url       text,

  -- Human-readable title — either set by the source tool or inferred by AI
  title            text,

  status           text        NOT NULL DEFAULT 'open'
                               CHECK (status IN ('open', 'resolved', 'deleted')),

  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  resolved_at      timestamptz,
  resolved_by      text,       -- display name of whoever closed the thread

  -- Each (workspace, source, source_thread_id) triple must be unique so webhook
  -- delivery can safely upsert without creating duplicate threads.
  UNIQUE (workspace_id, source, source_thread_id)
);

COMMENT ON TABLE  comment_threads IS 'Normalised conversation threads ingested from Figma, Slack, Jira, and Notion.';
COMMENT ON COLUMN comment_threads.source_thread_id IS 'External ID in the originating tool (Figma comment ID, Slack thread_ts, Jira issue key, Notion block ID).';
COMMENT ON COLUMN comment_threads.source_url       IS 'Deep-link back to the thread in the originating tool.';


-- ── 2. thread_comments ────────────────────────────────────────────────────────
-- Individual messages/replies that belong to a thread.
-- sequence_order lets us reconstruct the exact chronological conversation for
-- AI summarisation without relying on created_at precision across tools.

CREATE TABLE IF NOT EXISTS thread_comments (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id          uuid        NOT NULL REFERENCES comment_threads(id) ON DELETE CASCADE,

  -- The originating tool's ID for this specific comment
  source_comment_id  text,

  -- Author identity — all three fields optional; we populate whatever the source gives us
  author_name        text,
  author_email       text,
  author_source_id   text,       -- e.g. Figma user ID, Slack user ID

  body               text        NOT NULL,

  -- Soft-lifecycle fields
  edited_at          timestamptz,
  deleted_at         timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),

  -- Position in the thread; used to order messages for AI prompts
  sequence_order     int         NOT NULL DEFAULT 0,

  UNIQUE (thread_id, source_comment_id)
);

COMMENT ON TABLE  thread_comments IS 'Individual messages within a comment thread, in chronological order.';
COMMENT ON COLUMN thread_comments.sequence_order IS 'Zero-based position in thread; used to order messages for AI summarisation without relying on created_at precision.';


-- ── 3. thread_decisions ───────────────────────────────────────────────────────
-- Structured decisions extracted from a thread by the AI pipeline.
-- A thread can have zero or more decisions — a single long Slack thread might
-- surface two or three separate choices that were made.

CREATE TABLE IF NOT EXISTS thread_decisions (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id        uuid        NOT NULL REFERENCES comment_threads(id) ON DELETE CASCADE,

  decision_text    text        NOT NULL,
  rationale        text,
  owner            text,

  -- Everyone who should be aware of / accountable to this decision
  stakeholders     text[]      NOT NULL DEFAULT '{}',

  -- 0.0–1.0; extractions below ~0.65 are surfaced for human review in the inbox
  confidence_score numeric(3,2) CHECK (confidence_score BETWEEN 0 AND 1),

  created_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  thread_decisions IS 'AI-extracted decisions from a comment thread. One thread may yield multiple decisions.';
COMMENT ON COLUMN thread_decisions.confidence_score IS '0.0–1.0 AI confidence. Items below 0.65 are queued for human review before promotion.';
COMMENT ON COLUMN thread_decisions.stakeholders IS 'Display names of people who need to know about this decision.';


-- ── 4. thread_summaries ───────────────────────────────────────────────────────
-- One summary per thread, generated when the thread resolves (or on demand).
-- posted_to_slack + slack_message_ts track whether the summary was surfaced in
-- the workspace's notification channel so we don't double-post.

CREATE TABLE IF NOT EXISTS thread_summaries (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id               uuid        NOT NULL REFERENCES comment_threads(id) ON DELETE CASCADE,

  summary_text            text        NOT NULL,

  -- Derived stats surfaced in the UI
  time_to_resolve_minutes int,
  stakeholders_involved   text[]      NOT NULL DEFAULT '{}',
  decision_made           boolean     NOT NULL DEFAULT false,

  -- Slack notification tracking
  posted_to_slack         boolean     NOT NULL DEFAULT false,
  slack_message_ts        text,

  created_at              timestamptz NOT NULL DEFAULT now(),

  -- Only one active summary per thread (regeneration replaces the previous row)
  UNIQUE (thread_id)
);

COMMENT ON TABLE  thread_summaries IS 'AI-generated summary produced when a thread resolves. One per thread; regeneration replaces the previous row.';
COMMENT ON COLUMN thread_summaries.time_to_resolve_minutes IS 'Wall-clock time from thread created_at to resolved_at, in minutes.';
COMMENT ON COLUMN thread_summaries.decision_made IS 'True when at least one thread_decision was extracted with confidence >= 0.65.';


-- ── 5. sync_events ────────────────────────────────────────────────────────────
-- Append-only log of every incoming webhook event.
-- raw_payload is the verbatim JSON body from the originating tool — this is the
-- source of truth for replay. processed_at is null until the processor runs;
-- error captures the failure reason so failed events can be retried.

CREATE TABLE IF NOT EXISTS sync_events (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     uuid        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  source           text        NOT NULL CHECK (source IN ('figma', 'slack', 'jira', 'notion')),
  event_type       text        NOT NULL CHECK (event_type IN ('created', 'edited', 'resolved', 'reopened', 'deleted')),
  source_thread_id text        NOT NULL,

  -- Full webhook body, preserved verbatim for replayability
  raw_payload      jsonb       NOT NULL DEFAULT '{}',

  processed_at     timestamptz,          -- null = not yet processed
  error            text                  -- null = success or not yet attempted
);

COMMENT ON TABLE  sync_events IS 'Append-only log of incoming webhook events. raw_payload is verbatim for replay. processed_at=null means pending.';
COMMENT ON COLUMN sync_events.raw_payload IS 'Full webhook body from the originating tool. Never mutated — used for replay if the processor changes.';
COMMENT ON COLUMN sync_events.error IS 'Null on success. Set to the error message when processing fails so the event can be retried.';


-- ─────────────────────────────────────────────────────────────────────────────
-- Indexes
-- ─────────────────────────────────────────────────────────────────────────────

-- comment_threads
-- Webhook dedup: "have we seen this thread before?" — the hot path on every event
CREATE INDEX IF NOT EXISTS comment_threads_source_lookup_idx
  ON comment_threads (workspace_id, source, source_thread_id);

CREATE INDEX IF NOT EXISTS comment_threads_workspace_idx
  ON comment_threads (workspace_id);

CREATE INDEX IF NOT EXISTS comment_threads_project_idx
  ON comment_threads (project_id)
  WHERE project_id IS NOT NULL;

-- Status filtering: inbox queries fetch open threads only
CREATE INDEX IF NOT EXISTS comment_threads_status_idx
  ON comment_threads (workspace_id, status);

-- thread_comments
-- Thread page needs all comments ordered for a given thread
CREATE INDEX IF NOT EXISTS thread_comments_thread_idx
  ON thread_comments (thread_id, sequence_order);

-- thread_decisions
CREATE INDEX IF NOT EXISTS thread_decisions_thread_idx
  ON thread_decisions (thread_id);

-- Low-confidence items need their own queue: AI review inbox
CREATE INDEX IF NOT EXISTS thread_decisions_low_confidence_idx
  ON thread_decisions (thread_id, confidence_score)
  WHERE confidence_score < 0.65;

-- thread_summaries — unique constraint already creates an index on thread_id

-- sync_events
-- Webhook processor queries pending events in order
CREATE INDEX IF NOT EXISTS sync_events_pending_idx
  ON sync_events (workspace_id, source, processed_at)
  WHERE processed_at IS NULL;

-- Replay by source thread
CREATE INDEX IF NOT EXISTS sync_events_source_thread_idx
  ON sync_events (workspace_id, source, source_thread_id);


-- ─────────────────────────────────────────────────────────────────────────────
-- Row-Level Security
-- ─────────────────────────────────────────────────────────────────────────────
-- Pattern: a user can see a row iff their user_id appears in workspace_members
-- for the row's workspace_id. This is the same pattern used by decisions,
-- feedback_items, and all other Memry tables.
--
-- All tables are read/write for workspace members — access differentiation
-- (e.g. admin-only deletes) is enforced at the API layer, not in RLS.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── comment_threads ──────────────────────────────────────────────────────────
ALTER TABLE comment_threads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workspace_members_read_comment_threads"
  ON comment_threads FOR SELECT
  USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "workspace_members_write_comment_threads"
  ON comment_threads FOR ALL
  USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
    )
  );

-- ── thread_comments ───────────────────────────────────────────────────────────
ALTER TABLE thread_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workspace_members_read_thread_comments"
  ON thread_comments FOR SELECT
  USING (
    thread_id IN (
      SELECT id FROM comment_threads
      WHERE workspace_id IN (
        SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
      )
    )
  );

CREATE POLICY "workspace_members_write_thread_comments"
  ON thread_comments FOR ALL
  USING (
    thread_id IN (
      SELECT id FROM comment_threads
      WHERE workspace_id IN (
        SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
      )
    )
  );

-- ── thread_decisions ──────────────────────────────────────────────────────────
ALTER TABLE thread_decisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workspace_members_read_thread_decisions"
  ON thread_decisions FOR SELECT
  USING (
    thread_id IN (
      SELECT id FROM comment_threads
      WHERE workspace_id IN (
        SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
      )
    )
  );

CREATE POLICY "workspace_members_write_thread_decisions"
  ON thread_decisions FOR ALL
  USING (
    thread_id IN (
      SELECT id FROM comment_threads
      WHERE workspace_id IN (
        SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
      )
    )
  );

-- ── thread_summaries ─────────────────────────────────────────────────────────
ALTER TABLE thread_summaries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workspace_members_read_thread_summaries"
  ON thread_summaries FOR SELECT
  USING (
    thread_id IN (
      SELECT id FROM comment_threads
      WHERE workspace_id IN (
        SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
      )
    )
  );

CREATE POLICY "workspace_members_write_thread_summaries"
  ON thread_summaries FOR ALL
  USING (
    thread_id IN (
      SELECT id FROM comment_threads
      WHERE workspace_id IN (
        SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
      )
    )
  );

-- ── sync_events ───────────────────────────────────────────────────────────────
-- sync_events has workspace_id directly, so no join needed.
-- Note: only service-role (server) should write sync_events; client reads are
-- for admin/debug views only.
ALTER TABLE sync_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workspace_members_read_sync_events"
  ON sync_events FOR SELECT
  USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "workspace_members_write_sync_events"
  ON sync_events FOR ALL
  USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
    )
  );
