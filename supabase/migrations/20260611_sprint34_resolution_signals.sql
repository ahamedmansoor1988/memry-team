-- Sprint 34: resolution signals from Slack.
-- Run manually in the Supabase SQL Editor.

-- Track how an item was resolved
alter table feedback_items
  add column if not exists resolved_via text,          -- 'manual' | 'slack' | null
  add column if not exists slack_resolution_url text;  -- link to the Slack message

-- Medium-confidence suggestions awaiting user confirmation
create table if not exists resolution_suggestions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  feedback_item_id uuid not null references feedback_items(id) on delete cascade,
  slack_channel_id text not null,
  slack_message_ts text not null,
  slack_message_text text not null,
  slack_user_name text,
  match_confidence numeric not null,
  status text not null default 'pending',   -- pending | confirmed | dismissed
  created_at timestamptz not null default now(),
  unique (feedback_item_id, slack_message_ts)
);

-- Resolution tracking on processed messages
alter table slack_processed_messages
  add column if not exists resolution_extracted boolean not null default false;
