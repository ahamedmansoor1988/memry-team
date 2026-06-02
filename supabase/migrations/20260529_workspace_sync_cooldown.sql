-- Workspace-level sync cooldown.
-- Records when a pull was last initiated for each workspace.
-- Used by /api/figma/pull to enforce one sync per workspace per 5 minutes,
-- regardless of how many users or browser tabs trigger it simultaneously.
ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS last_pull_at timestamptz;
