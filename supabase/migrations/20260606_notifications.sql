-- Sprint 7: Smart Notifications
-- Adds per-workspace notification controls.

ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS notifications_enabled    boolean     DEFAULT true,
  ADD COLUMN IF NOT EXISTS notifications_last_scan  timestamptz;
