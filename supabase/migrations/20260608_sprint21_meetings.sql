-- Allow source = 'meeting' in decisions
-- The source column is text so no enum change needed.
-- Add meeting_title for future use
ALTER TABLE decisions ADD COLUMN IF NOT EXISTS meeting_title text;
ALTER TABLE decisions ADD COLUMN IF NOT EXISTS meeting_date  timestamptz;
