-- Server-side Figma OAuth tokens, keyed directly by user_id.
-- The existing /auth/figma callback stored these on a `workspaces` row via
-- `workspace_members`, but the current single-user Google-OAuth app never
-- creates a workspace for anyone — that path 404s with no_workspace for
-- every real user. This is the fix: a connection lives on the user directly.
-- Separate from the client-side-only Figma PAT (never sent to our servers,
-- see /privacy) — this is a distinct, explicitly-consented OAuth grant with
-- a narrow scope (files:read, file_comments:write), needed so a background
-- job can act without a browser tab open.

create table if not exists figma_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  access_token text not null,
  refresh_token text not null,
  expires_at timestamptz not null,
  figma_user_id text,
  figma_user_email text,
  connected_at timestamptz not null default now()
);

alter table figma_connections enable row level security;
