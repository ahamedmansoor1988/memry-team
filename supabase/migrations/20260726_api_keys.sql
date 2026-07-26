-- API keys + credit balances for programmatic access to scans.
-- Keys are minted manually (admin-controlled) rather than self-serve for now.
-- Only the raw key's SHA-256 hash is stored — the plaintext key is shown once
-- at creation time and never persisted or retrievable again.
-- All access goes through the service-role client: RLS is enabled with no
-- policies, so anon/authenticated keys are locked out and only the service
-- role (server-side code) can read/write these tables.

create extension if not exists pgcrypto;

create table if not exists api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  label text,
  key_hash text not null unique,
  key_prefix text not null,
  credits_remaining int not null default 0,
  credits_granted int not null default 0,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

create index if not exists api_keys_user_id_idx on api_keys(user_id);

create table if not exists api_key_usage (
  id uuid primary key default gen_random_uuid(),
  api_key_id uuid not null references api_keys(id) on delete cascade,
  scan_type text not null,
  created_at timestamptz not null default now()
);

create index if not exists api_key_usage_api_key_id_idx on api_key_usage(api_key_id);

alter table api_keys enable row level security;
alter table api_key_usage enable row level security;

-- Atomically checks the key is valid/unrevoked/has credit, decrements by 1,
-- and records the usage — all in one round trip so concurrent requests on
-- the same key can't both read a stale balance and both succeed past zero.
create or replace function consume_api_credit(p_key_hash text, p_scan_type text)
returns table (ok boolean, user_id uuid, credits_remaining int, reason text)
language plpgsql
security definer
as $$
declare
  v_row api_keys%rowtype;
begin
  select * into v_row from api_keys where key_hash = p_key_hash for update;

  if not found then
    return query select false, null::uuid, 0, 'invalid_key';
    return;
  end if;

  if v_row.revoked_at is not null then
    return query select false, v_row.user_id, v_row.credits_remaining, 'revoked';
    return;
  end if;

  if v_row.credits_remaining <= 0 then
    return query select false, v_row.user_id, 0, 'insufficient_credits';
    return;
  end if;

  update api_keys
    set credits_remaining = credits_remaining - 1,
        last_used_at = now()
    where id = v_row.id;

  insert into api_key_usage (api_key_id, scan_type) values (v_row.id, p_scan_type);

  return query select true, v_row.user_id, v_row.credits_remaining - 1, null::text;
end;
$$;
