-- Base tables that predate the tracked migrations. Reconstructed from code
-- usage when the original Supabase project was lost (paused >90 days).
-- All access goes through the service-role client, so RLS is enabled with no
-- policies: service role bypasses RLS, anon/authenticated keys are locked out.

create extension if not exists pgcrypto;

create table if not exists workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  figma_access_token text,
  figma_refresh_token text,
  figma_token_expires_at timestamptz,
  figma_user_id text,
  figma_user_email text,
  figma_connected_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists workspace_members (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member',
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table if not exists extension_styles (
  url text primary key,
  styles jsonb not null,
  captured_at timestamptz not null default now()
);

alter table workspaces enable row level security;
alter table workspace_members enable row level security;
alter table extension_styles enable row level security;
