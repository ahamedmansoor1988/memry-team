-- Sprint 6: Decision Intelligence
-- Stores structured decisions extracted from resolved feedback items.

CREATE TABLE IF NOT EXISTS decisions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  feedback_item_id uuid REFERENCES feedback_items(id) ON DELETE SET NULL,
  decision_text    text NOT NULL,
  reason           text,
  owner_name       text,
  owner_profile_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  source           text NOT NULL DEFAULT 'manual',
  decided_at       timestamptz NOT NULL DEFAULT now(),
  created_at       timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS decisions_workspace_idx     ON decisions (workspace_id);
CREATE INDEX IF NOT EXISTS decisions_feedback_item_idx ON decisions (feedback_item_id);
