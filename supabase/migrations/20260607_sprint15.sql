-- Sprint 15: Activity Feed Index
-- Speeds up the real activity feed query which filters by workspace_id
-- and orders by created_at DESC.

CREATE INDEX IF NOT EXISTS feedback_item_status_history_workspace_created_idx
  ON feedback_item_status_history (workspace_id, created_at DESC);
