-- Sprint 27: status automation columns
ALTER TABLE feedback_items
  ADD COLUMN IF NOT EXISTS escalated_at timestamptz,
  ADD COLUMN IF NOT EXISTS stale_at timestamptz,
  ADD COLUMN IF NOT EXISTS overdue_decision_at timestamptz;

CREATE INDEX IF NOT EXISTS feedback_items_status_age_idx
  ON feedback_items (workspace_id, status, created_at)
  WHERE deleted_at IS NULL;

-- Sprint 28: weekly briefs cache
CREATE TABLE IF NOT EXISTS weekly_briefs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE,
  week_start date NOT NULL,
  headline text,
  decisions_summary text,
  attention_needed jsonb,
  blockers_summary text,
  momentum text,
  momentum_reason text,
  generated_at timestamptz DEFAULT now(),
  UNIQUE(workspace_id, week_start)
);

-- Sprint 29: notifications
CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
  type text NOT NULL,
  title text NOT NULL,
  body text,
  feedback_item_id uuid REFERENCES feedback_items(id) ON DELETE CASCADE,
  read_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notifications_user_unread_idx
  ON notifications (user_id, read_at)
  WHERE read_at IS NULL;
