-- Identity Layer: unified profiles across Figma, Slack, and Memry.
-- Email is the join key. All fields except workspace_id and display_name are optional.

CREATE TABLE IF NOT EXISTS profiles (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  display_name    text NOT NULL,
  email           text,
  avatar_url      text,
  figma_handle    text,
  figma_user_id   text,
  slack_handle    text,
  slack_user_id   text,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  UNIQUE(workspace_id, email)
);

-- Link feedback items back to the resolved author profile.
ALTER TABLE feedback_items
  ADD COLUMN IF NOT EXISTS author_profile_id uuid REFERENCES profiles(id);
