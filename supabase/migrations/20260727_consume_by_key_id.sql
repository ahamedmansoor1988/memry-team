-- Same logic as consume_api_credit(key_hash, ...), but keyed by api_key_id
-- directly. Used for the interactive web app, where the server already has
-- an authenticated Supabase session and a resolved api_keys row — there's no
-- raw external API key/hash to look up, unlike a genuine external API call.
create or replace function consume_api_credit_by_id(p_api_key_id uuid, p_scan_type text)
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
  insert into api_key_usage (api_key_id, scan_type) values (v_key.id, p_scan_type);

  select coalesce(sum(credits - credits_used), 0) into v_remaining
    from credit_batches
    where api_key_id = v_key.id and expires_at > now();

  return query select true, v_remaining, null::text;
end;
$$;
