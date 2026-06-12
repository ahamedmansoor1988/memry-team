-- Sprint 35: Linker Agent
-- Topics (user-facing: "Linked discussions"), membership links,
-- rejection memory, and pgvector embeddings.

create extension if not exists vector;

-- The organizational topic. UI never says "topic" — it says Linked Discussion.
create table if not exists topics (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  title         text not null,
  summary       text,
  status        text not null default 'active',   -- active | resolved | stale
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);
create index if not exists topics_workspace_idx on topics (workspace_id);

-- Membership: feedback_items and decisions can belong to a topic.
create table if not exists topic_links (
  id            uuid primary key default gen_random_uuid(),
  topic_id      uuid not null references topics(id) on delete cascade,
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  item_type     text not null,                    -- 'feedback_item' | 'decision'
  item_id       uuid not null,
  confidence    numeric not null,
  status        text not null default 'active',   -- active | suggested
  linked_by     text not null default 'linker',   -- linker | user
  created_at    timestamptz default now(),
  unique(topic_id, item_type, item_id)
);
create index if not exists topic_links_topic_idx on topic_links (topic_id);
create index if not exists topic_links_item_idx  on topic_links (workspace_id, item_type, item_id);

-- Never re-suggest a dismissed pairing.
create table if not exists topic_link_rejections (
  workspace_id  uuid not null,
  item_type     text not null,
  item_id       uuid not null,
  topic_id      uuid not null,
  created_at    timestamptz default now(),
  primary key (workspace_id, item_type, item_id, topic_id)
);

-- Embeddings: one row per item, hash-skipped on re-embed.
create table if not exists item_embeddings (
  workspace_id       uuid not null references workspaces(id) on delete cascade,
  item_type          text not null,
  item_id            uuid not null,
  embedding          vector(1536) not null,
  embedded_text_hash text not null,
  created_at         timestamptz default now(),
  primary key (item_type, item_id)
);
create index if not exists item_embeddings_ws_idx on item_embeddings (workspace_id);

-- Cosine retrieval. Exact scan is fine at current scale; add an ivfflat
-- index when workspaces pass ~50k embedded items.
create or replace function match_items(
  p_workspace_id uuid,
  p_embedding    vector(1536),
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
