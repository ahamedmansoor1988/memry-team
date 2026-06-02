-- Status System: resolved_at / archived_at timestamps + status history table.
-- Status values: open | needs_decision | resolved | archived
-- Application-layer transition enforcement (no DB CHECK constraint for beta).

-- 1. Add status timestamps to feedback_items
ALTER TABLE feedback_items
  ADD COLUMN IF NOT EXISTS resolved_at  timestamptz,
  ADD COLUMN IF NOT EXISTS archived_at  timestamptz;

-- 2. Backfill resolved_at for items that were already resolved
UPDATE feedback_items
SET resolved_at = updated_at
WHERE status = 'resolved'
  AND resolved_at IS NULL;

-- 3. Status history table
CREATE TABLE IF NOT EXISTS feedback_item_status_history (
  id           uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  item_id      uuid        NOT NULL REFERENCES feedback_items(id) ON DELETE CASCADE,
  workspace_id uuid        NOT NULL REFERENCES workspaces(id)     ON DELETE CASCADE,
  from_status  text,
  to_status    text        NOT NULL,
  changed_by   uuid        REFERENCES auth.users(id),
  reason       text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_status_history_item_id
  ON feedback_item_status_history(item_id);
CREATE INDEX IF NOT EXISTS idx_status_history_workspace_created
  ON feedback_item_status_history(workspace_id, created_at DESC);

-- 4. RLS: workspace members can read their own workspace's history
ALTER TABLE feedback_item_status_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workspace_members_read_status_history"
  ON feedback_item_status_history FOR SELECT
  USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
    )
  );
