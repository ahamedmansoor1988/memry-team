-- Add unique index on figma_handle so we can upsert profiles using handle
-- as the conflict key. handle is always present in Figma comment user objects.
CREATE UNIQUE INDEX IF NOT EXISTS profiles_workspace_figma_handle_idx
  ON profiles (workspace_id, figma_handle)
  WHERE figma_handle IS NOT NULL;
