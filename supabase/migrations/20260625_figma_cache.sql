CREATE TABLE IF NOT EXISTS figma_node_cache (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_key     text NOT NULL,
  node_id      text NOT NULL,
  figma_nodes  jsonb NOT NULL,
  style_map    jsonb NOT NULL DEFAULT '{}',
  cached_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (file_key, node_id)
);

ALTER TABLE figma_node_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role full access" ON figma_node_cache USING (true) WITH CHECK (true);
