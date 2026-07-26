-- Tracks each user's PayPal Pro subscription status. All access goes through
-- the service-role client, so RLS is enabled with no policies: service role
-- bypasses RLS, anon/authenticated keys are locked out.

create table if not exists subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  paypal_subscription_id text not null unique,
  status text not null default 'pending', -- pending | active | cancelled | suspended | expired
  plan_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists subscriptions_user_id_idx on subscriptions(user_id);

alter table subscriptions enable row level security;
