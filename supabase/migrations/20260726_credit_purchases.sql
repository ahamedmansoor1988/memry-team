-- One-time credit pack purchases (PayPal Orders API, not Subscriptions —
-- see lib/paypal.ts for why). unique(paypal_order_id) makes the capture
-- route idempotent: if a user refreshes the PayPal return URL, or the
-- redirect fires twice, credits are only ever granted once per order.

create table if not exists credit_purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  paypal_order_id text not null unique,
  credits int not null,
  amount_usd text not null,
  status text not null default 'completed',
  created_at timestamptz not null default now()
);

create index if not exists credit_purchases_user_id_idx on credit_purchases(user_id);

alter table credit_purchases enable row level security;
