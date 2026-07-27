-- Credits expire 3 months from purchase. A single running counter on
-- api_keys can't represent that correctly once a user has bought more than
-- one pack (each batch needs its own expiry) — so credits are tracked as a
-- ledger of batches instead. api_keys.credits_remaining/credits_granted are
-- kept as a rough cumulative display cache only; consume_api_credit below
-- (the actual gate on every scan) is rewritten to check credit_batches
-- directly and is the only source of truth that respects expiry.

create table if not exists credit_batches (
  id uuid primary key default gen_random_uuid(),
  api_key_id uuid not null references api_keys(id) on delete cascade,
  credits int not null,
  credits_used int not null default 0,
  source text not null default 'purchase', -- purchase | trial | admin_grant
  purchased_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists credit_batches_api_key_id_idx on credit_batches(api_key_id);
create index if not exists credit_batches_expires_at_idx on credit_batches(expires_at);

alter table credit_batches enable row level security;

-- Consumes 1 credit from the batch closest to expiring (use-it-or-lose-it
-- credits first), skipping any batch that's already expired.
create or replace function consume_api_credit(p_key_hash text, p_scan_type text)
returns table (ok boolean, user_id uuid, credits_remaining int, reason text)
language plpgsql
security definer
as $$
declare
  v_key api_keys%rowtype;
  v_batch credit_batches%rowtype;
  v_remaining int;
begin
  select * into v_key from api_keys where key_hash = p_key_hash for update;

  if not found then
    return query select false, null::uuid, 0, 'invalid_key';
    return;
  end if;

  if v_key.revoked_at is not null then
    return query select false, v_key.user_id, 0, 'revoked';
    return;
  end if;

  select * into v_batch
    from credit_batches
    where api_key_id = v_key.id
      and expires_at > now()
      and credits_used < credits
    order by expires_at asc
    for update skip locked
    limit 1;

  if not found then
    return query select false, v_key.user_id, 0, 'insufficient_credits';
    return;
  end if;

  update credit_batches set credits_used = credits_used + 1 where id = v_batch.id;
  update api_keys set last_used_at = now() where id = v_key.id;
  insert into api_key_usage (api_key_id, scan_type) values (v_key.id, p_scan_type);

  select coalesce(sum(credits - credits_used), 0) into v_remaining
    from credit_batches
    where api_key_id = v_key.id and expires_at > now();

  return query select true, v_key.user_id, v_remaining, null::text;
end;
$$;

-- Live, expiry-aware balance for a key — use this for display, not the
-- api_keys.credits_remaining cache, which doesn't know about expiry.
create or replace function available_credits(p_api_key_id uuid)
returns int
language sql
stable
as $$
  select coalesce(sum(credits - credits_used), 0)::int
  from credit_batches
  where api_key_id = p_api_key_id and expires_at > now();
$$;
