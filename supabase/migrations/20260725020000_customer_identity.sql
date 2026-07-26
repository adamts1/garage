-- ============================================================
--  Phase 3.6 — a customer is identified by who they are, not what they're called.
--
--  findOrCreateCustomer matched on name: `.eq('name', t.customer)`. Two problems,
--  one already half-addressed by moving resolution into create_ticket:
--
--   * Two different people named "David Cohen" became one customer — every
--     ticket for either landed on a single record.
--   * The client used .maybeSingle(), which THROWS on more than one match, so
--     the second David Cohen didn't just merge — he broke ticket creation.
--     (create_ticket's `limit 1` already stopped the throw; this fixes the merge.)
--
--  Name is not identity. A garage knows a returning customer by their ת״ז or by
--  their phone. So:
--
--   1. If a ת״ז was given, match on it — it is a legal identity, unique per
--      person. A partial unique index makes "two customers, one ת״ז, one garage"
--      impossible rather than merely avoided.
--   2. Otherwise, if a phone was given, match on that.
--   3. Otherwise, create a new customer. Never dedupe on name — we would rather
--      hold two records for one walk-in than merge two people.
-- ============================================================

-- ת״ז is unique within a garage. Partial, because most private customers have no
-- ת״ז recorded and NULLs must not collide. Verified no existing duplicates on
-- local, staging or production before adding this.
create unique index if not exists customers_garage_id_number_key
  on public.customers (garage_id, id_number)
  where id_number is not null;

-- A non-unique index for the phone-match path: phones are a lookup key, not an
-- identity (a household or a business line can be shared), so no uniqueness here.
create index if not exists customers_garage_phone_idx
  on public.customers (garage_id, phone)
  where phone is not null;

-- ---------- create_ticket, with identity-based customer resolution ----------
-- Replaces the name match inside the function. Everything else about it is
-- unchanged from 20260725000000; a create-or-replace is the only way to edit a
-- function, since the original migration is already applied.
create or replace function public.create_ticket(t jsonb, works jsonb default '[]'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  g           uuid := public.current_garage_id();
  next_key    integer;
  next_job    integer;
  new_key     text;
  new_job     text;
  cust_id     uuid;
  cust_name   text := nullif(t->>'customer_name', '');
  v_id_number text := nullif(t->>'id_number', '');
  v_phone     text := nullif(t->>'phone', '');
  new_ticket  public.tickets;
  w           jsonb;
  wid         uuid;
  p           jsonb;
begin
  if g is null then
    raise exception 'no garage for the current session' using errcode = '42501';
  end if;

  insert into public.garage_counters (garage_id, last_ticket, last_job)
  values (g, 1, 1)
  on conflict (garage_id) do update
    set last_ticket = public.garage_counters.last_ticket + 1,
        last_job    = public.garage_counters.last_job + 1
  returning last_ticket, last_job into next_key, next_job;

  new_key := 'GAR-' || next_key;
  new_job := 'W-' || next_job;

  -- Identity, not name. ת״ז first (authoritative), then phone (a lookup key),
  -- then create. A ticket with a customer name but neither identifier always
  -- opens a fresh record rather than guessing.
  if v_id_number is not null then
    select id into cust_id from public.customers
      where garage_id = g and id_number = v_id_number
      limit 1;
  elsif v_phone is not null then
    select id into cust_id from public.customers
      where garage_id = g and phone = v_phone
      limit 1;
  end if;

  if cust_id is null and cust_name is not null then
    insert into public.customers (name, phone, email, address, id_number, kind)
    values (
      cust_name, v_phone,
      nullif(t->>'email', ''), nullif(t->>'address', ''), v_id_number,
      case when (t->'flags') ? 'עסקי' then 'עסקי' else 'פרטי' end
    )
    returning id into cust_id;
  elsif cust_id is not null and v_id_number is not null then
    -- Matched by phone but now carrying a ת״ז we lacked; fill it, never overwrite.
    update public.customers set id_number = v_id_number
      where id = cust_id and public.customers.id_number is null;
  end if;

  insert into public.tickets (
    key, job, status, type, epic, priority, points, assignee, title, plate, car,
    customer_id, customer_name, phone, email, address, km, year, amount, done,
    subtasks, flags, due, blocked, notes, paid, pay_method, doc, reference,
    id_number, vehicle_code
  )
  values (
    new_key, new_job,
    coalesce(t->>'status','todo'), coalesce(t->>'type','job'),
    coalesce(t->>'epic','service'), coalesce(t->>'priority','med'),
    coalesce((t->>'points')::int, 3), coalesce(t->>'assignee','dk'),
    coalesce(t->>'title',''), nullif(t->>'plate',''), nullif(t->>'car',''),
    cust_id, cust_name, v_phone, nullif(t->>'email',''),
    nullif(t->>'address',''), nullif(t->>'km',''), nullif(t->>'year',''),
    coalesce((t->>'amount')::numeric, 0), coalesce((t->>'done')::int, 0),
    coalesce((select array_agg(value::text) from jsonb_array_elements_text(t->'subtasks')), '{}'),
    coalesce((select array_agg(value::text) from jsonb_array_elements_text(t->'flags')), '{}'),
    nullif(t->>'due',''), nullif(t->>'blocked',''), nullif(t->>'notes',''),
    coalesce((t->>'paid')::boolean, false), nullif(t->>'pay_method',''),
    nullif(t->>'doc',''), nullif(t->>'reference',''),
    v_id_number, nullif(t->>'vehicle_code','')
  )
  returning * into new_ticket;

  for w in select * from jsonb_array_elements(works)
  loop
    insert into public.works (ticket_id, uid, code, name, labor, custom, position)
    values (
      new_ticket.id,
      coalesce(w->>'uid', gen_random_uuid()::text),
      nullif(w->>'code',''), coalesce(w->>'name',''),
      coalesce((w->>'labor')::numeric, 0),
      coalesce((w->>'custom')::boolean, false),
      coalesce((w->>'position')::int, 0)
    )
    returning id into wid;

    for p in select * from jsonb_array_elements(coalesce(w->'items', '[]'::jsonb))
    loop
      insert into public.work_items (work_id, sku, name, qty, price, position)
      values (
        wid, nullif(p->>'sku',''), coalesce(p->>'name',''),
        coalesce((p->>'qty')::numeric, 1), coalesce((p->>'price')::numeric, 0),
        coalesce((p->>'position')::int, 0)
      );
    end loop;
  end loop;

  return jsonb_build_object('id', new_ticket.id, 'key', new_key, 'job', new_job);
end $$;

revoke all on function public.create_ticket(jsonb, jsonb) from public;
grant execute on function public.create_ticket(jsonb, jsonb) to authenticated;
