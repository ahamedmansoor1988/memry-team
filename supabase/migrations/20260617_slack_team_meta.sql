-- Store Slack team name and connection timestamp on the workspace row so the
-- Integrations page can display them without an extra Slack API call.
ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS slack_team_name    text,
  ADD COLUMN IF NOT EXISTS slack_connected_at timestamptz;

COMMENT ON COLUMN workspaces.slack_team_name IS
  'Human-readable Slack team/workspace name, stored at OAuth time (tokenData.team.name)';
COMMENT ON COLUMN workspaces.slack_connected_at IS
  'Timestamp of the most recent successful Slack OAuth connection';
