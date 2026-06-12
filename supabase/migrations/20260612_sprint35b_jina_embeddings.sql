-- Sprint 35b: Switch embedding provider from OpenAI (1536 dims) to Jina AI (1024 dims).
-- Drops and recreates item_embeddings with the correct dimension, and updates match_items.

drop function if exists match_items(uuid, vector(1536), float, int, text, uuid);
drop table if exists item_embeddings;

create table item_embeddings (
  workspace_id       uuid not null references workspaces(id) on delete cascade,
  item_type          text not null,
  item_id            uuid not null,
  embedding          vector(1024) not null,
  embedded_text_hash text not null,
  created_at         timestamptz default now(),
  primary key (item_type, item_id)
);
create index if not exists item_embeddings_ws_idx on item_embeddings (workspace_id);

create or replace function match_items(
  p_workspace_id uuid,
  p_embedding    vector(1024),
  p_threshold    float,
  p_count        int,
  p_exclude_type text,
  p_exclude_id   uuid
)
returns table (
  item_type  text,
  item_id    uuid,
  similarity float
)
language sql stable as $$
  select
    e.item_type,
    e.item_id,
    1 - (e.embedding <=> p_embedding) as similarity
  from item_embeddings e
  where e.workspace_id = p_workspace_id
    and not (e.item_type = p_exclude_type and e.item_id = p_exclude_id)
    and 1 - (e.embedding <=> p_embedding) >= p_threshold
  order by e.embedding <=> p_embedding
  limit p_count;
$$;
