-- Sprint 11: Accountability Tracking
-- Adds three columns to track how long items have been blocked and whether
-- they've been escalated. All columns are optional so existing rows stay valid.

ALTER TABLE feedback_items
  ADD COLUMN IF NOT EXISTS blocked_since      timestamptz,
  ADD COLUMN IF NOT EXISTS escalated_at       timestamptz,
  ADD COLUMN IF NOT EXISTS escalation_count   integer DEFAULT 0;
