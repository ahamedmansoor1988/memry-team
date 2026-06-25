ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS figma_access_token   text,
  ADD COLUMN IF NOT EXISTS figma_refresh_token  text,
  ADD COLUMN IF NOT EXISTS figma_token_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS figma_user_id        text,
  ADD COLUMN IF NOT EXISTS figma_user_email     text;
