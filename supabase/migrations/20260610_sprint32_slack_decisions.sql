-- Track which Slack messages we have already processed
CREATE TABLE IF NOT EXISTS slack_processed_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE,
  slack_channel_id text NOT NULL,
  slack_message_ts text NOT NULL,
  decision_extracted boolean DEFAULT false,
  processed_at timestamptz DEFAULT now(),
  UNIQUE(workspace_id, slack_channel_id, slack_message_ts)
);

CREATE INDEX IF NOT EXISTS slack_processed_messages_ws_idx
  ON slack_processed_messages (workspace_id, slack_channel_id);

-- Add slack source columns to decisions table
ALTER TABLE decisions
  ADD COLUMN IF NOT EXISTS slack_channel_id text,
  ADD COLUMN IF NOT EXISTS slack_message_ts text,
  ADD COLUMN IF NOT EXISTS slack_channel_name text,
  ADD COLUMN IF NOT EXISTS slack_thread_url text;

-- Store Slack team ID on workspace for event routing
ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS slack_team_id text;
