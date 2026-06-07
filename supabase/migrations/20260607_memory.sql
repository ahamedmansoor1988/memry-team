-- Sprint 13: Organizational Memory
-- Stores curated memory entries (decisions, patterns, context) that the AI
-- search assistant uses as its knowledge base.

CREATE TABLE IF NOT EXISTS memory_entries (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid        NOT NULL,
  type         text        NOT NULL,          -- 'decision' | 'pattern' | 'context'
  title        text        NOT NULL,
  content      text        NOT NULL,          -- full searchable text
  source_ids   text[]      DEFAULT '{}',      -- decision ids or feedback_item ids
  tags         text[]      DEFAULT '{}',
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS memory_entries_workspace_idx ON memory_entries(workspace_id);
CREATE INDEX IF NOT EXISTS memory_entries_type_idx      ON memory_entries(type);
