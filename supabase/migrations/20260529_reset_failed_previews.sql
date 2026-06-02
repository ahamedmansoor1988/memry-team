-- Reset permanently-failed preview records so they can be retried.
-- Records hit MAX_RETRIES=5 and are stuck with preview_retry_count>=5 indefinitely.
-- This resets them to pending so the next preview-job run can attempt generation again.
UPDATE design_references
SET preview_status        = 'pending',
    preview_retry_count   = 0,
    preview_next_retry_at = NULL,
    preview_error_reason  = NULL,
    updated_at            = now()
WHERE preview_status IN ('failed', 'generating');
