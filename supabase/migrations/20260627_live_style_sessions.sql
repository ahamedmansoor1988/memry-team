create table if not exists live_style_sessions (
  id          uuid primary key default gen_random_uuid(),
  session_key text not null unique,
  styles      jsonb not null default '[]',
  created_at  timestamptz not null default now()
);

-- Auto-delete sessions older than 24 hours (keep storage clean)
create index if not exists live_style_sessions_created_at_idx
  on live_style_sessions (created_at);
