-- Add Google OAuth tokens to workspaces (same pattern as Jira/Notion)
ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS google_access_token  text,
  ADD COLUMN IF NOT EXISTS google_refresh_token text,
  ADD COLUMN IF NOT EXISTS google_token_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS google_connected_at  timestamptz;

-- Assets table: unified index for Drive, local, and Figma assets
CREATE TABLE IF NOT EXISTS assets (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid        REFERENCES workspaces(id) ON DELETE CASCADE,
  source        text        NOT NULL CHECK (source IN ('google_drive', 'local', 'figma')),
  external_id   text,
  name          text        NOT NULL,
  mime_type     text,
  thumbnail_url text,
  download_url  text,
  file_size     bigint,
  metadata      jsonb,
  indexed_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, source, external_id)
);

CREATE INDEX IF NOT EXISTS assets_workspace_idx ON assets (workspace_id, source);

ALTER TABLE assets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service role full access" ON assets;
CREATE POLICY "service role full access" ON assets USING (true) WITH CHECK (true);
