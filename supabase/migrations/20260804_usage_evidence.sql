-- Capture IP + user agent per scan, so a payment dispute can be answered.
-- Card networks treat "this charge was fraudulent" as the merchant's burden
-- to disprove, and processors specifically ask for IP/device data and login
-- timestamps as evidence. Until now api_key_usage recorded only which key
-- ran what and when — enough to show credits were consumed, but not that
-- they were consumed by the same person/device that paid.
--
-- Both consume functions must be dropped rather than replaced: adding
-- parameters changes the signature, so CREATE OR REPLACE would register a
-- second overload and make later calls ambiguous instead of updating these.

alter table api_key_usage
  add column if not exists ip text,
  add column if not exists user_agent text;

drop function if exists consume_api_credit_by_id(uuid, text);

create or replace function consume_api_credit_by_id(
  p_api_key_id uuid,
  p_scan_type text,
  p_ip text default null,
  p_user_agent text default null
)
returns table (ok boolean, credits_remaining int, reason text)
language plpgsql
security definer
as $$
declare
  v_key api_keys%rowtype;
  v_batch credit_batches%rowtype;
  v_remaining int;
begin
  select * into v_key from api_keys where id = p_api_key_id for update;
  if not found then
    return query select false, 0, 'invalid_key';
    return;
  end if;
  if v_key.revoked_at is not null then
    return query select false, 0, 'revoked';
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
    return query select false, 0, 'insufficient_credits';
    return;
  end if;
  update credit_batches set credits_used = credits_used + 1 where id = v_batch.id;
  update api_keys set last_used_at = now() where id = v_key.id;
  insert into api_key_usage (api_key_id, scan_type, ip, user_agent)
    values (v_key.id, p_scan_type, p_ip, p_user_agent);
  select coalesce(sum(credits - credits_used), 0) into v_remaining
    from credit_batches
    where api_key_id = v_key.id and expires_at > now();
  return query select true, v_remaining, null::text;
end;
$$;

drop function if exists consume_api_credit(text, text);

create or replace function consume_api_credit(
  p_key_hash text,
  p_scan_type text,
  p_ip text default null,
  p_user_agent text default null
)
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
  insert into api_key_usage (api_key_id, scan_type, ip, user_agent)
    values (v_key.id, p_scan_type, p_ip, p_user_agent);
  select coalesce(sum(credits - credits_used), 0) into v_remaining
    from credit_batches
    where api_key_id = v_key.id and expires_at > now();
  return query select true, v_key.user_id, v_remaining, null::text;
end;
$$;
