-- Sprint 37: log every question the Slack bot answers, so the dashboard can
-- show real value ("X questions answered this week") instead of raw counts.

create table if not exists answered_questions (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references workspaces(id) on delete cascade,
  slack_channel_id text not null,
  slack_message_ts text not null,
  question         text not null,
  answer           text not null,
  source           text,
  created_at       timestamptz default now()
);
create index if not exists answered_questions_ws_idx
  on answered_questions (workspace_id, created_at desc);
