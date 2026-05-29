-- Preview resilience: retry scheduling, error tracking, metrics support
-- Adds columns to design_references to make preview generation a safe async layer

-- Expand preview_status to include 'generating' (in-flight lock to prevent double-processing)
-- Valid values: pending | generating | ready | failed | stale
-- No ALTER TYPE needed — we use plain text

-- Retry tracking
ALTER TABLE design_references
  ADD COLUMN IF NOT EXISTS preview_last_attempt_at  timestamptz,
  ADD COLUMN IF NOT EXISTS preview_retry_count      int         NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS preview_next_retry_at    timestamptz,
  ADD COLUMN IF NOT EXISTS preview_error_reason     text;
-- preview_error_reason values: rate_limited | node_missing | permission_denied | images_api_error | unknown

-- Index for the job query: "give me records that are due for processing"
CREATE INDEX IF NOT EXISTS design_references_job_idx
  ON design_references (workspace_id, preview_status, preview_next_retry_at);

COMMENT ON COLUMN design_references.preview_status IS
  'pending = not yet attempted | generating = in-flight | ready = has thumbnail_url | failed = gave up after retries | stale = ready but needs refresh';
COMMENT ON COLUMN design_references.preview_last_attempt_at IS
  'Timestamp of the most recent enrichment attempt';
COMMENT ON COLUMN design_references.preview_retry_count IS
  'Number of failed attempts so far. Resets to 0 on success.';
COMMENT ON COLUMN design_references.preview_next_retry_at IS
  'NULL = not yet attempted or cleared after success. Set to a future timestamp after failure.';
COMMENT ON COLUMN design_references.preview_error_reason IS
  'Last error category: rate_limited | node_missing | permission_denied | images_api_error | unknown';
