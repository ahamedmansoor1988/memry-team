-- Sprint 17: Decision Outcomes + Alternatives
-- Adds three columns so teams can record what actually happened after a
-- decision and what alternatives were considered.

ALTER TABLE decisions ADD COLUMN IF NOT EXISTS outcome               text;
ALTER TABLE decisions ADD COLUMN IF NOT EXISTS alternatives          text[];
ALTER TABLE decisions ADD COLUMN IF NOT EXISTS outcome_recorded_at   timestamptz;
