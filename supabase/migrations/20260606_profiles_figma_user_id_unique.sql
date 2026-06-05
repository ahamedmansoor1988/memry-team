-- Add a partial unique index on figma_user_id so we can upsert profiles
-- using figma_user_id as the conflict key when email is not available.
CREATE UNIQUE INDEX IF NOT EXISTS profiles_workspace_figma_user_id_idx
  ON profiles (workspace_id, figma_user_id)
  WHERE figma_user_id IS NOT NULL;
