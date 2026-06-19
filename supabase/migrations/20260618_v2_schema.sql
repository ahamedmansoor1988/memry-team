-- ─────────────────────────────────────────────────────────────────────────────
-- Memry v2 schema
-- Adds integration columns to workspaces and creates the 5 core tables.
-- Safe to run on top of the existing DB: all uses IF NOT EXISTS / ADD COLUMN IF NOT EXISTS.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── workspaces: add v2 integration columns ────────────────────────────────────
ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS figma_connected_at     timestamptz,
  ADD COLUMN IF NOT EXISTS figma_team_id          text,
  ADD COLUMN IF NOT EXISTS jira_access_token      text,
  ADD COLUMN IF NOT EXISTS jira_refresh_token     text,
  ADD COLUMN IF NOT EXISTS jira_cloud_id          text,
  ADD COLUMN IF NOT EXISTS jira_connected_at      timestamptz,
  ADD COLUMN IF NOT EXISTS notion_access_token    text,
  ADD COLUMN IF NOT EXISTS notion_connected_at    timestamptz,
  ADD COLUMN IF NOT EXISTS slack_signing_secret   text,
  ADD COLUMN IF NOT EXISTS last_slack_webhook_at  timestamptz,
  ADD COLUMN IF NOT EXISTS last_figma_webhook_at  timestamptz,
  ADD COLUMN IF NOT EXISTS last_jira_webhook_at   timestamptz,
  ADD COLUMN IF NOT EXISTS last_notion_webhook_at timestamptz;

-- ── projects ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS projects (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name             text NOT NULL,
  slack_channel_id   text,
  slack_channel_name text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS slack_channel_id   text,
  ADD COLUMN IF NOT EXISTS slack_channel_name text;

CREATE INDEX IF NOT EXISTS projects_workspace_id_idx ON projects (workspace_id);

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "projects_workspace_member" ON projects;
CREATE POLICY "projects_workspace_member" ON projects
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
  ));

-- ── threads ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS threads (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id       uuid REFERENCES projects(id) ON DELETE SET NULL,
  source           text NOT NULL CHECK (source IN ('slack', 'figma', 'jira', 'notion')),
  source_thread_id text NOT NULL,
  source_url       text,
  title            text,
  status           text NOT NULL DEFAULT 'open'
                     CHECK (status IN ('open', 'resolved', 'reopened', 'deleted')),
  classification   text
                     CHECK (classification IN ('decision', 'blocker', 'risk', 'question', 'vague', 'noise')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  resolved_at      timestamptz,
  UNIQUE (workspace_id, source, source_thread_id)
);

CREATE INDEX IF NOT EXISTS threads_workspace_idx      ON threads (workspace_id);
CREATE INDEX IF NOT EXISTS threads_project_idx        ON threads (project_id) WHERE project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS threads_status_idx         ON threads (workspace_id, status);
CREATE INDEX IF NOT EXISTS threads_classification_idx ON threads (workspace_id, classification)
  WHERE classification IS NOT NULL;

ALTER TABLE threads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "threads_workspace_member" ON threads;
CREATE POLICY "threads_workspace_member" ON threads
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
  ));

-- ── comments ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS comments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id         uuid NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  source_comment_id text NOT NULL,
  author_name       text,
  author_email      text,
  body              text NOT NULL,
  edited_at         timestamptz,
  deleted_at        timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  sequence_order    integer NOT NULL DEFAULT 0,
  UNIQUE (thread_id, source_comment_id)
);

CREATE INDEX IF NOT EXISTS comments_thread_idx ON comments (thread_id);

ALTER TABLE comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "comments_via_thread" ON comments;
CREATE POLICY "comments_via_thread" ON comments
  USING (thread_id IN (
    SELECT t.id FROM threads t
    JOIN workspace_members wm ON wm.workspace_id = t.workspace_id
    WHERE wm.user_id = auth.uid()
  ));

-- ── decisions ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS decisions (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id            uuid NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  workspace_id         uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id           uuid REFERENCES projects(id) ON DELETE SET NULL,
  what                 text NOT NULL,
  why                  text,
  who                  text,
  stakeholders         text[] NOT NULL DEFAULT '{}',
  rejected_alternatives text[] NOT NULL DEFAULT '{}',
  confidence_score     integer CHECK (confidence_score BETWEEN 0 AND 100),
  created_at           timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE decisions
  ADD COLUMN IF NOT EXISTS what                 text,
  ADD COLUMN IF NOT EXISTS why                  text,
  ADD COLUMN IF NOT EXISTS who                  text,
  ADD COLUMN IF NOT EXISTS stakeholders         text[],
  ADD COLUMN IF NOT EXISTS rejected_alternatives text[],
  ADD COLUMN IF NOT EXISTS confidence_score     integer;

CREATE INDEX IF NOT EXISTS decisions_workspace_idx ON decisions (workspace_id);
CREATE INDEX IF NOT EXISTS decisions_thread_idx    ON decisions (thread_id);

ALTER TABLE decisions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "decisions_workspace_member" ON decisions;
CREATE POLICY "decisions_workspace_member" ON decisions
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
  ));

-- ── summaries ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS summaries (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id                uuid NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  summary_text             text NOT NULL,
  time_to_resolve_minutes  integer,
  decision_made            boolean NOT NULL DEFAULT false,
  blockers_identified      text[] NOT NULL DEFAULT '{}',
  risks_identified         text[] NOT NULL DEFAULT '{}',
  posted_to_slack          boolean NOT NULL DEFAULT false,
  slack_ts                 text,
  created_at               timestamptz NOT NULL DEFAULT now(),
  UNIQUE (thread_id)
);

CREATE INDEX IF NOT EXISTS summaries_thread_idx ON summaries (thread_id);

ALTER TABLE summaries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "summaries_via_thread" ON summaries;
CREATE POLICY "summaries_via_thread" ON summaries
  USING (thread_id IN (
    SELECT t.id FROM threads t
    JOIN workspace_members wm ON wm.workspace_id = t.workspace_id
    WHERE wm.user_id = auth.uid()
  ));

-- ── sync_events ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sync_events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source           text NOT NULL,
  event_type       text NOT NULL,
  source_thread_id text NOT NULL,
  raw_payload      jsonb NOT NULL DEFAULT '{}',
  processed        boolean NOT NULL DEFAULT false,
  error            text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE sync_events
  ADD COLUMN IF NOT EXISTS processed boolean,
  ADD COLUMN IF NOT EXISTS error     text;

CREATE INDEX IF NOT EXISTS sync_events_workspace_idx   ON sync_events (workspace_id);
CREATE INDEX IF NOT EXISTS sync_events_unprocessed_idx ON sync_events (created_at)
  WHERE processed = false;

ALTER TABLE sync_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sync_events_workspace_member" ON sync_events;
CREATE POLICY "sync_events_workspace_member" ON sync_events
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
  ));
