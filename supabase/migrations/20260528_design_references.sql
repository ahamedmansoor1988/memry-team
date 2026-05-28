-- Design References: shared cache of Figma frame thumbnails
-- One record per (workspace, file_key, node_id) — shared across all comments on the same frame

CREATE TABLE IF NOT EXISTS design_references (
  id             uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id   uuid        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  file_key       text        NOT NULL,
  node_id        text        NOT NULL,
  frame_name     text,
  page_name      text,
  thumbnail_url  text,
  preview_status text        NOT NULL DEFAULT 'pending', -- pending | ready | failed | stale
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, file_key, node_id)
);

CREATE INDEX IF NOT EXISTS design_references_workspace_idx ON design_references (workspace_id);
CREATE INDEX IF NOT EXISTS design_references_file_node_idx ON design_references (file_key, node_id);

-- Link feedback_items to design_references
ALTER TABLE feedback_items
  ADD COLUMN IF NOT EXISTS design_reference_id uuid REFERENCES design_references(id);

-- Also add frame_name to figma_comments for fast lookup
ALTER TABLE figma_comments
  ADD COLUMN IF NOT EXISTS frame_name text;

-- Ensure page_name column exists (may not have been migrated yet)
ALTER TABLE figma_comments
  ADD COLUMN IF NOT EXISTS page_name text;

-- Slack columns on workspaces
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS slack_bot_token      text;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS slack_channel_id     text;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS slack_signing_secret text;

-- Slack thread tracking on feedback_items
ALTER TABLE feedback_items ADD COLUMN IF NOT EXISTS slack_message_ts  text;
ALTER TABLE feedback_items ADD COLUMN IF NOT EXISTS slack_channel_id  text;
