-- Sprint 14: Live sync consolidation
-- Ensures all columns written by the live sync path exist.
-- Safe to run multiple times (ADD COLUMN IF NOT EXISTS).

-- Projects soft-delete
ALTER TABLE projects ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- Feedback items: AI suggested action (written at ingest time)
ALTER TABLE feedback_items ADD COLUMN IF NOT EXISTS ai_suggested_action text;

-- Feedback items: author profile FK (set during sync profile upsert)
ALTER TABLE feedback_items
  ADD COLUMN IF NOT EXISTS author_profile_id uuid
  REFERENCES profiles(id) ON DELETE SET NULL;

-- Index for soft-deleted project filtering
CREATE INDEX IF NOT EXISTS projects_deleted_at_idx
  ON projects (workspace_id, deleted_at)
  WHERE deleted_at IS NULL;
