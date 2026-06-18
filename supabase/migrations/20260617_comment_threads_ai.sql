-- AI classification columns for comment_threads.
-- Added by the sync engine when the first comment in a new thread is processed.

ALTER TABLE comment_threads
  ADD COLUMN IF NOT EXISTS ai_classification text
    CHECK (ai_classification IN ('decision', 'blocker', 'question', 'noise')),
  ADD COLUMN IF NOT EXISTS ai_summary text;

COMMENT ON COLUMN comment_threads.ai_classification IS
  'decision | blocker | question | noise — set by Groq when the first comment arrives.';
COMMENT ON COLUMN comment_threads.ai_summary IS
  'One-sentence AI summary of what the thread is about.';

-- Index to power the inbox query: "show me all open decision threads"
CREATE INDEX IF NOT EXISTS comment_threads_classification_idx
  ON comment_threads (workspace_id, ai_classification, status)
  WHERE ai_classification IS NOT NULL;
