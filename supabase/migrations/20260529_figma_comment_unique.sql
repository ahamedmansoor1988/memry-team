-- Ensure figma_comment_id is unique per figma_file_id.
-- This prevents duplicate rows if two sync runs race on the same file.
--
-- Existing data: deduplicate first (keep the row with the lowest created_at),
-- then add the constraint.

-- 1. Delete duplicate figma_comments, keeping the oldest row per (figma_file_id, figma_comment_id)
DELETE FROM figma_comments
WHERE id IN (
  SELECT id FROM (
    SELECT id,
           ROW_NUMBER() OVER (
             PARTITION BY figma_file_id, figma_comment_id
             ORDER BY created_at ASC
           ) AS rn
    FROM figma_comments
  ) ranked
  WHERE rn > 1
);

-- 2. Add unique constraint so DB enforces it going forward
ALTER TABLE figma_comments
  ADD CONSTRAINT figma_comments_file_comment_unique
  UNIQUE (figma_file_id, figma_comment_id);
