-- Sprint 8: Preview Images
-- Adds a lazily-populated preview_url column to both comment and item tables.
-- Separate from figma_preview_url (enrichment-job path) so the two caching
-- layers never conflict.

ALTER TABLE figma_comments
  ADD COLUMN IF NOT EXISTS preview_url text;

ALTER TABLE feedback_items
  ADD COLUMN IF NOT EXISTS preview_url text;
