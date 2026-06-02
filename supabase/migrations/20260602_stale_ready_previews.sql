-- Mark all ready thumbnails as stale so they are re-enriched with the
-- updated image parameters (format=jpg, scale=0.5) on the next enrichment run.
-- Stale records are processed by both the cron preview-job and the manual
-- "Generate Frame Preview" button.  preview_next_retry_at is cleared so the
-- record is eligible immediately (subject to Figma quota availability).
UPDATE design_references
SET preview_status        = 'stale',
    preview_next_retry_at = NULL,
    updated_at            = now()
WHERE preview_status = 'ready';
