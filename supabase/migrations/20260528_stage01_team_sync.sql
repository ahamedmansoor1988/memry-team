-- Stage 01: Add team-level Figma settings to workspaces
ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS figma_team_id   text,
  ADD COLUMN IF NOT EXISTS figma_user_id   text,
  ADD COLUMN IF NOT EXISTS figma_pat       text,
  ADD COLUMN IF NOT EXISTS slack_webhook_url text;

-- Add mention_me flag and project_name to figma_comments for richer display
ALTER TABLE figma_comments
  ADD COLUMN IF NOT EXISTS mentions_me     boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS project_name    text;
