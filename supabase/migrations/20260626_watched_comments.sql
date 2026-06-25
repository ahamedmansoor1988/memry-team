-- ─────────────────────────────────────────────────────────────────────────────
-- Comment Clarity Agent
-- Tracks which Figma comments have been classified and replied to,
-- so re-runs skip already-processed comments.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS watched_comments (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  file_key            text        NOT NULL,
  comment_id          text        NOT NULL,
  comment_text        text        NOT NULL,
  author_handle       text,
  figma_created_at    timestamptz,
  classification      text        NOT NULL CHECK (classification IN ('vague', 'specific', 'skip')),
  clarifying_question text,
  reply_comment_id    text,
  replied_at          timestamptz,
  processed_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (file_key, comment_id)
);

CREATE INDEX IF NOT EXISTS watched_comments_file_idx ON watched_comments (file_key);
CREATE INDEX IF NOT EXISTS watched_comments_unreplied_idx
  ON watched_comments (file_key)
  WHERE classification = 'vague' AND reply_comment_id IS NULL;

ALTER TABLE watched_comments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service role full access" ON watched_comments;
CREATE POLICY "service role full access" ON watched_comments USING (true) WITH CHECK (true);
