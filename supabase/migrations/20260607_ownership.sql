-- Sprint 10: Ownership Engine
-- Adds owner tracking to feedback_items so Memry can say "waiting on Sarah"
-- instead of just "a decision is waiting".

ALTER TABLE feedback_items
  ADD COLUMN IF NOT EXISTS owner_profile_id uuid REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS owner_name       text,
  ADD COLUMN IF NOT EXISTS waiting_since    timestamptz,
  ADD COLUMN IF NOT EXISTS ownership_source text; -- 'ai' | 'manual' | 'slack'
