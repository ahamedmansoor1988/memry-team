-- A "watched" Figma file/frame for Brand Check: re-scanned unattended by a
-- cron job, diffed against last_findings, and only genuinely new violations
-- get posted as Figma comments — so a file with 40 existing issues doesn't
-- re-spam 40 comments every night, only whatever changed since last time.
-- brand_guide_text is snapshotted here (not a shared table) since the guide
-- itself lives client-side only today — the user explicitly opts this
-- specific snapshot into server-side storage when they turn watching on.

create table if not exists brand_watches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  file_key text not null,
  node_id text,
  label text,
  brand_guide_text text not null,
  last_findings jsonb not null default '[]'::jsonb,
  last_scanned_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, file_key, node_id)
);

create index if not exists brand_watches_user_id_idx on brand_watches(user_id);

alter table brand_watches enable row level security;
