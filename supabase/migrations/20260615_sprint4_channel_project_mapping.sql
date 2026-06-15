-- Sprint 4: Channel → project mapping for agency multi-client safety
-- Decisions from a mapped channel are scoped to that project.
-- The Linker and Q&A bot respect the boundary.

-- 1. Mapping table: one channel can map to at most one project per workspace.
create table if not exists slack_channel_mappings (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  slack_channel_id   text not null,
  slack_channel_name text,
  project_id    uuid not null references projects(id) on delete cascade,
  created_at    timestamptz not null default now(),
  constraint slack_channel_mappings_unique unique (workspace_id, slack_channel_id)
);

alter table slack_channel_mappings enable row level security;

create policy "workspace members can manage channel mappings"
  on slack_channel_mappings
  for all
  using (
    workspace_id in (
      select workspace_id from workspace_members where user_id = auth.uid()
    )
  );

-- 2. Stamp project_id on decisions captured from Slack.
--    Nullable: decisions from unmapped channels remain unscoped.
alter table decisions
  add column if not exists project_id uuid references projects(id) on delete set null;
