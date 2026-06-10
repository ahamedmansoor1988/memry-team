CREATE TABLE IF NOT EXISTS workspace_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE,
  email text NOT NULL,
  role text NOT NULL DEFAULT 'member',
  token text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
  invited_by uuid,  -- auth.users.id of the inviter
  accepted_at timestamptz,
  expires_at timestamptz DEFAULT now() + INTERVAL '7 days',
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS workspace_invites_token_idx
  ON workspace_invites (token);

CREATE INDEX IF NOT EXISTS workspace_invites_email_idx
  ON workspace_invites (email, workspace_id);

ALTER TABLE workspace_members
  ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'member';
