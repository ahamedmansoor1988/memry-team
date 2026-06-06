-- Stage 4B.1: Add soft-delete columns for Figma comment lifecycle.
-- deleted_at is set when a comment is removed from Figma; NULL means the row is live.

ALTER TABLE figma_comments
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

ALTER TABLE feedback_items
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
