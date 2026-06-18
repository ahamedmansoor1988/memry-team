-- Introduce 'rate_limited' as a distinct preview_status value.
--
-- Previously rate-limited frames were stored as preview_status='failed' with
-- preview_error_reason='rate_limited'. This conflated a transient queue
-- position with a genuine failure, causing the UI to show a red error state
-- for frames that are simply waiting for the next cron cycle.
--
-- New status lifecycle:
--   pending      → not yet attempted
--   generating   → in-flight (locked by an active job; prevents double-runs)
--   ready        → has thumbnail_url
--   rate_limited → Figma 429; will be re-queued when preview_next_retry_at passes
--   failed       → genuine failure (node_missing / permission_denied / etc.)
--   stale        → ready but marked for refresh
--
-- No schema change is needed (preview_status is plain text with no CHECK
-- constraint), but we migrate existing rows so they surface correctly in the
-- UI and are picked up by cron queries that now include 'rate_limited'.

UPDATE design_references
SET    preview_status = 'rate_limited'
WHERE  preview_status      = 'failed'
  AND  preview_error_reason = 'rate_limited';

-- Update the column comment to reflect the full valid set.
COMMENT ON COLUMN design_references.preview_status IS
  'pending = not yet attempted | generating = in-flight | ready = has thumbnail_url | rate_limited = Figma 429, re-queued | failed = gave up after retries | stale = ready but needs refresh';
