-- ============================================================================
--  BASELINE — the whole schema, as of 2026-08-11, in one file.
--
--  This replaces the eighteen migrations that built it (20260730000000 through
--  20260811000000). They were squashed once every environment had applied all
--  of them, so this file's version is deliberately the LAST of the eighteen:
--  staging and production already carry 20260811000000 as applied, which means
--  the squash changed no database anywhere. It is a rewrite of the history, not
--  a migration.
--
--  The filenames of the eighteen are still the handles used by comments across
--  the codebase. They are in git history — read one with:
--    git show <commit>:supabase/migrations/20260806010000_partial_credit_notes.sql
--
--  Two things a pg_dump-based squash silently loses. Both are restored by hand
--  at the foot of this file; both are the reason a squash must be verified
--  rather than eyeballed. See the note down there before squashing again.
--
--  Verified by diffing a 984-line catalogue fingerprint — columns, constraints,
--  indexes, policies, RLS flags, functions (by body hash), triggers, grants,
--  default privileges, sequences, views, enums, extensions, publications,
--  replica identity and storage buckets — of a database built from the eighteen
--  migrations against one built from this file alone. They are identical.
-- ============================================================================




SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "extensions";






COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."create_ticket"("t" "jsonb", "works" "jsonb" DEFAULT '[]'::"jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  g           uuid := public.current_garage_id();
  next_key    integer;
  next_job    integer;
  new_key     text;
  new_job     text;
  cust_id     uuid;
  picked_id   uuid;
  cust_name   text := nullif(t->>'customer_name', '');
  v_id_number text := nullif(t->>'id_number', '');
  v_phone     text := nullif(t->>'phone', '');
  v_digits    text := nullif(regexp_replace(coalesce(t->>'phone', ''), '\D', '', 'g'), '');
  v_plate     text := nullif(t->>'plate', '');
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

  -- A picked customer beats any derivation: the advisor looked at the record
  -- and said "this one". Only ours, and only if it still exists.
  begin
    picked_id := nullif(t->>'customer_id', '')::uuid;
  exception when invalid_text_representation then
    picked_id := null;   -- garbage in the field is ignored, not fatal
  end;

  if picked_id is not null then
    select id into cust_id from public.customers
      where id = picked_id and garage_id = g;
  end if;

  -- ת״ז next, and it is the only derivation left. It identifies because the
  -- database will not let two customers hold one: a match is that person, and
  -- not somebody who happens to answer the same telephone.
  --
  -- The phone used to be consulted here, ahead of this, and removing it is what
  -- this migration is. Resolving by it made a second customer on one number
  -- impossible to open: a household shares a line, a company answers for eleven
  -- vans, and every ticket typed with that number was attached to whoever held
  -- it first regardless of the name on the form. The intake forms now name the
  -- holder and offer to attach the ticket to them; taking the offer sends
  -- customer_id, which is handled above. Declining it is a ticket for a
  -- different person who shares a number, and that has to be openable.
  if cust_id is null and v_id_number is not null then
    select id into cust_id from public.customers
      where garage_id = g and id_number = v_id_number
      limit 1;
  end if;

  -- A name alone is not an identity: with neither a phone nor a ת״ז there is
  -- nothing to match on next time, so we do not open a record we could only
  -- ever duplicate. The ticket keeps the name either way.
  if cust_id is null and cust_name is not null
     and (v_id_number is not null or v_digits is not null) then
    insert into public.customers (name, phone, email, address, id_number, kind)
    values (
      cust_name, v_phone,
      nullif(t->>'email', ''), nullif(t->>'address', ''), v_id_number,
      case when (t->'flags') ? 'business' then 'business' else 'private' end
    )
    returning id into cust_id;
  elsif cust_id is not null and v_id_number is not null then
    -- Fill a ת״ז we lacked; never overwrite one already on file, and never one
    -- another customer here already holds — the partial unique index would
    -- raise and take the whole ticket down with it.
    update public.customers set id_number = v_id_number
      where id = cust_id
        and public.customers.id_number is null
        and not exists (
          select 1 from public.customers other
           where other.garage_id = g and other.id_number = v_id_number
        );
  end if;

  -- Same for the phone: a picked (or ת״ז-matched) customer with no number on
  -- file gets this ticket's, so the next visit resolves by phone like any other.
  if cust_id is not null and v_phone is not null then
    update public.customers set phone = v_phone
      where id = cust_id and public.customers.phone is null;
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
    coalesce((t->>'points')::int, 3), nullif(t->>'assignee',''),
    coalesce(t->>'title',''), v_plate, nullif(t->>'car',''),
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

  -- Promote the vehicle onto the customer so the next ticket auto-fills it.
  -- Only when we have both a customer to hang it on and a real plate: a walk-in
  -- with no car sends plate '-' (App.tsx) and must not create a phantom vehicle.
  -- On a return visit the same (customer, plate) updates in place. coalesce keeps
  -- what we already knew when a later ticket leaves a field blank, so a sparse
  -- ticket never erases a fuller record; a supplied value (a fresh km reading)
  -- wins.
  --
  -- The key is (customer_id, plate), not the plate alone: one car legitimately
  -- belongs to two customers — a couple sharing it, a car sold on — and each
  -- owner gets their own row. That is why the plate is not a customer identity
  -- key above.
  if cust_id is not null and v_plate is not null and v_plate <> '-' then
    insert into public.vehicles (
      customer_id, plate, manufacturer, model, year, km, vehicle_code
    )
    values (
      cust_id, v_plate,
      nullif(t->>'manufacturer',''), nullif(t->>'model',''),
      nullif(t->>'year',''), nullif(t->>'km',''), nullif(t->>'vehicle_code','')
    )
    on conflict (customer_id, plate) do update set
      manufacturer = coalesce(excluded.manufacturer, public.vehicles.manufacturer),
      model        = coalesce(excluded.model,        public.vehicles.model),
      year         = coalesce(excluded.year,         public.vehicles.year),
      km           = coalesce(excluded.km,           public.vehicles.km),
      vehicle_code = coalesce(excluded.vehicle_code, public.vehicles.vehicle_code);
  end if;

  for w in select * from jsonb_array_elements(works)
  loop
    insert into public.works (ticket_id, uid, code, name, labor, custom, position, notes)
    values (
      new_ticket.id,
      coalesce(w->>'uid', gen_random_uuid()::text),
      nullif(w->>'code',''), coalesce(w->>'name',''),
      coalesce((w->>'labor')::numeric, 0),
      coalesce((w->>'custom')::boolean, false),
      coalesce((w->>'position')::int, 0),
      nullif(w->>'notes','')
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


ALTER FUNCTION "public"."create_ticket"("t" "jsonb", "works" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."create_ticket"("t" "jsonb", "works" "jsonb") IS 'Atomic new-ticket path: assigns GAR-/W- numbers under a per-garage row lock, resolves the customer by an explicitly picked (and garage-checked) customer_id and then by ת״ז, and inserts the ticket with its works and parts in one transaction. The identity is customers.id. The phone is NOT resolved by: one number legitimately belongs to several customers, so the intake forms name the holder and send customer_id when the advisor attaches the ticket to them. ת״ז is optional and unique per garage. A name with neither creates no customer. Garage comes from current_garage_id(), never the payload. See docs/PRODUCTION.md §3.4, §3.5, §3.6.';



CREATE OR REPLACE FUNCTION "public"."credit_note_within_invoice"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  invoice_total numeric(12,2);
  already numeric(12,2);
begin
  -- Only a credit note that names its parent is bounded by anything. A note
  -- written before 20260806010000 carries no link and is not re-litigated here.
  if new.doc_type <> 'credit_note' or new.credits_invoice_id is null then
    return new;
  end if;

  select total into invoice_total
    from public.invoices
   where id = new.credits_invoice_id
     for update;

  if invoice_total is null then
    raise exception 'credit note names an invoice that does not exist: %', new.credits_invoice_id
      using errcode = 'foreign_key_violation';
  end if;

  -- After the lock, so this sees anything a competing transaction committed
  -- while we waited for it.
  select coalesce(sum(total), 0) into already
    from public.invoices
   where credits_invoice_id = new.credits_invoice_id
     and doc_type = 'credit_note';

  if already + new.total > invoice_total then
    raise exception
      'credit notes against invoice % would come to %, more than the % it was issued for',
      new.credits_invoice_id, already + new.total, invoice_total
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."credit_note_within_invoice"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."credit_note_within_invoice"() IS 'Refuses a credit note that would take the total credited past the invoice it credits. Locks that invoice, so two credits issued at the same instant cannot both pass the check.';



CREATE OR REPLACE FUNCTION "public"."current_garage_id"() RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select m.garage_id
  from public.garage_members m
  left join public.garage_workers w
    on w.user_id = m.user_id and w.garage_id = m.garage_id
  where m.user_id = auth.uid()
    and coalesce(w.active, true)
  limit 1
$$;


ALTER FUNCTION "public"."current_garage_id"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."current_garage_id"() IS 'The garage the current user belongs to, or NULL when unauthenticated OR deactivated. Since 2c this is also the DEFAULT for garage_id on every tenant table, so an unauthenticated insert fails NOT NULL rather than landing in the backfill tenant. A retired member resolves to NULL, which the apps render as the no-garage state. LIMIT 1: multi-garage membership needs an explicit chooser, not an arbitrary row. See docs/PRODUCTION.md §4.';



CREATE OR REPLACE FUNCTION "public"."enforce_ticket_photo_limit"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  existing integer;
begin
  perform 1 from public.tickets where id = new.ticket_id for update;

  select count(*) into existing
    from public.ticket_photos
   where ticket_id = new.ticket_id;

  if existing >= 2 then
    raise exception 'a ticket may hold at most 2 photos'
      using errcode = 'check_violation', hint = 'delete one before adding another';
  end if;

  return new;
end
$$;


ALTER FUNCTION "public"."enforce_ticket_photo_limit"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."enforce_ticket_photo_limit"() IS 'At most two photos per ticket. INSERT only, so tickets that already hold more keep them.';



CREATE OR REPLACE FUNCTION "public"."ensure_worker_for_member"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  handle  text;
  seat    integer;
  palette text[] := array[
    '#1d2d44', '#3e5c76', '#4f7a5b', '#748cab', '#8d5b4c', '#6b4f7a', '#a5763f', '#41707e'
  ];
begin
  if exists (
    select 1 from public.garage_workers
     where garage_id = new.garage_id and user_id = new.user_id
  ) then
    return new;
  end if;

  select split_part(u.email, '@', 1) into handle
    from auth.users u where u.id = new.user_id;
  handle := coalesce(nullif(handle, ''), 'staff');

  select count(*) + 1 into seat
    from public.garage_workers where garage_id = new.garage_id;

  insert into public.garage_workers (garage_id, user_id, code, name, initials, color, position)
  values (
    new.garage_id,
    new.user_id,
    -- Unique per garage: the code is the key tickets store in `assignee`.
    left(handle, 6) || '-' || seat,
    handle,
    upper(left(handle, 2)),
    palette[1 + ((seat - 1) % array_length(palette, 1))],
    seat
  );

  return new;
end $$;


ALTER FUNCTION "public"."ensure_worker_for_member"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."ensure_worker_for_member"() IS 'Gives every new membership a worker row, so "can sign in" and "appears on the staff screen" cannot drift apart. Placeholder name and colour; manage-staff overwrites them with what was typed, and the screen edits them afterwards.';



CREATE OR REPLACE FUNCTION "public"."garage_staff"() RETURNS TABLE("id" "uuid", "code" "text", "name" "text", "initials" "text", "color" "text", "position" integer, "active" boolean, "user_id" "uuid", "email" "text", "role" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select w.id, w.code, w.name, w.initials, w.color, w.position, w.active, w.user_id,
         u.email::text, m.role
  from public.garage_workers w
  left join public.garage_members m
    on m.user_id = w.user_id and m.garage_id = w.garage_id
  left join auth.users u on u.id = w.user_id
  where w.garage_id = public.current_garage_id()
    and public.is_garage_admin()
  order by w.position
$$;


ALTER FUNCTION "public"."garage_staff"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."garage_staff"() IS 'The garage''s people for the staff screen: the worker row joined to its membership role and its account email. SECURITY DEFINER because neither of the last two is client-readable; returns nothing unless the caller is an admin of the garage, and the garage is taken from current_garage_id() so there is no argument to forge.';



CREATE OR REPLACE FUNCTION "public"."inherit_garage_from_customer"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  select c.garage_id into new.garage_id
  from public.customers c
  where c.id = new.customer_id;
  return new;
end $$;


ALTER FUNCTION "public"."inherit_garage_from_customer"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."inherit_garage_from_ticket"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  select t.garage_id into new.garage_id
  from public.tickets t
  where t.id = new.ticket_id;
  return new;
end $$;


ALTER FUNCTION "public"."inherit_garage_from_ticket"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."inherit_garage_from_work"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  select w.garage_id into new.garage_id
  from public.works w
  where w.id = new.work_id;
  return new;
end $$;


ALTER FUNCTION "public"."inherit_garage_from_work"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."inherit_garage_from_work_def"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  select w.garage_id into new.garage_id
  from public.work_defs w
  where w.id = new.work_def_id;
  return new;
end $$;


ALTER FUNCTION "public"."inherit_garage_from_work_def"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."invoice_credited_total"("invoice" "uuid") RETURNS numeric
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select coalesce(sum(note.total), 0)::numeric
    from public.invoices note
    join public.invoices original on original.id = note.credits_invoice_id
   where note.credits_invoice_id = invoice
     and note.doc_type = 'credit_note'
     and original.garage_id = public.current_garage_id()
$$;


ALTER FUNCTION "public"."invoice_credited_total"("invoice" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."invoice_credited_total"("invoice" "uuid") IS 'Sum of the credit notes already issued against an invoice, 0 when none. Scoped to the caller''s garage. What may still be credited is the invoice total minus this.';



CREATE OR REPLACE FUNCTION "public"."invoice_paid_total"("invoice" "uuid") RETURNS numeric
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select coalesce(sum(payment.total), 0)::numeric
    from public.invoices payment
    join public.invoices original on original.id = payment.pays_invoice_id
   where payment.pays_invoice_id = invoice
     and payment.doc_type = 'receipt'
     and original.garage_id = public.current_garage_id()
$$;


ALTER FUNCTION "public"."invoice_paid_total"("invoice" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."invoice_paid_total"("invoice" "uuid") IS 'Sum of the receipts issued against a tax invoice, 0 when none. Scoped to the caller''s garage. What is still owed is the invoice total, less this, less invoice_credited_total().';



CREATE OR REPLACE FUNCTION "public"."invoices_are_immutable"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  if tg_op = 'DELETE' then
    raise exception 'invoices cannot be deleted — cancel with a credit note';
  end if;
  -- allow ONLY the cancellation link to change
  if row(new.*) is distinct from row(old.*) then
    if new.status = 'cancelled' and old.status = 'issued'
       and new.provider_docnum = old.provider_docnum
       and new.total = old.total and new.lines = old.lines then
      return new;   -- a cancellation, permitted
    end if;
    raise exception 'an issued invoice is immutable';
  end if;
  return new;
end $$;


ALTER FUNCTION "public"."invoices_are_immutable"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_garage_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$
  select exists (
    select 1 from public.garage_members
     where user_id = (select auth.uid()) and role = 'admin'
  )
$$;


ALTER FUNCTION "public"."is_garage_admin"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."is_garage_admin"() IS 'Whether the current user is an admin of their garage. SECURITY INVOKER: garage_members_read_own is the boundary, not this function.';



CREATE OR REPLACE FUNCTION "public"."my_garages"() RETURNS TABLE("garage_id" "uuid", "garage_name" "text", "role" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select g.id, g.name, m.role
  from public.garages g
  join public.garage_members m on m.garage_id = g.id
  left join public.garage_workers w
    on w.user_id = m.user_id and w.garage_id = m.garage_id
  where m.user_id = (select auth.uid())
    and coalesce(w.active, true)
  order by g.name
$$;


ALTER FUNCTION "public"."my_garages"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."my_garages"() IS 'Garages the current user belongs to, with their role in each. Empty for anon and for a user with no membership — the login gate must treat both as "cannot proceed". See docs/PRODUCTION.md §5 Phase 2b.';



CREATE OR REPLACE FUNCTION "public"."new_photo_share_code"() RETURNS "text"
    LANGUAGE "sql"
    SET "search_path" TO ''
    AS $$
  select string_agg(
           substr('abcdefghijkmnpqrstuvwxyz23456789', (get_byte(bytes, i) % 32) + 1, 1),
           ''
         )
  from (select extensions.gen_random_bytes(10) as bytes) g,
       generate_series(0, 9) as i
$$;


ALTER FUNCTION "public"."new_photo_share_code"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."new_photo_share_code"() IS 'A photo''s public share code: ten characters, 50 bits, no look-alike glyphs. Uniqueness is enforced by ticket_photos_share_code_key, not here.';



CREATE OR REPLACE FUNCTION "public"."receipt_within_invoice"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  invoice_total numeric(12,2);
  invoice_type text;
  collected numeric(12,2);
  credited numeric(12,2);
begin
  if new.doc_type <> 'receipt' or new.pays_invoice_id is null then
    return new;
  end if;

  select total, doc_type into invoice_total, invoice_type
    from public.invoices
   where id = new.pays_invoice_id
     for update;

  if invoice_total is null then
    raise exception 'receipt names an invoice that does not exist: %', new.pays_invoice_id
      using errcode = 'foreign_key_violation';
  end if;

  -- A מס-קבלה was already paid when it was issued, and a receipt against a
  -- credit note or another receipt is meaningless.
  if invoice_type <> 'tax_invoice' then
    raise exception 'only a tax invoice can be settled by a receipt, not a %', invoice_type
      using errcode = 'check_violation';
  end if;

  select coalesce(sum(total), 0) into collected
    from public.invoices
   where pays_invoice_id = new.pays_invoice_id and doc_type = 'receipt';

  -- Credited money was never collected and never will be, so it is not still
  -- owed: an invoice for 1,000 with 200 credited is settled by 800.
  select coalesce(sum(total), 0) into credited
    from public.invoices
   where credits_invoice_id = new.pays_invoice_id and doc_type = 'credit_note';

  if collected + new.total > invoice_total - credited then
    raise exception
      'receipts against invoice % would come to %, more than the % still owed on it',
      new.pays_invoice_id, collected + new.total, invoice_total - credited
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."receipt_within_invoice"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."receipt_within_invoice"() IS 'Refuses a receipt that would collect more than its tax invoice still owes, credits included. Locks that invoice, so two receipts issued at the same instant cannot both pass.';



CREATE OR REPLACE FUNCTION "public"."save_ticket_works"("p_ticket_id" "uuid", "works" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  w        jsonb;
  wid      uuid;
  p        jsonb;
  admin    boolean := public.is_garage_admin();
  existing jsonb;
  prev     jsonb;
begin
  -- Refuse to touch a ticket the caller cannot see. Without this the delete
  -- below would simply affect zero rows for someone else's ticket, which is
  -- safe but silent; a clear error is better than a no-op that looks like
  -- success.
  if not exists (select 1 from public.tickets where id = p_ticket_id) then
    raise exception 'ticket not found or not in your garage' using errcode = '42501';
  end if;

  -- What the works look like now, keyed by uid, so the wipe below does not take
  -- the only copy of the values the rule is about.
  select coalesce(
           jsonb_object_agg(uid, jsonb_build_object('name', name, 'labor', labor)),
           '{}'::jsonb)
    into existing
    from public.works
   where ticket_id = p_ticket_id;

  if not admin then
    for w in select * from jsonb_array_elements(coalesce(works, '[]'::jsonb))
    loop
      prev := existing -> (w->>'uid');
      if prev is not null then
        if coalesce(w->>'name', '') is distinct from coalesce(prev->>'name', '')
           or coalesce((w->>'labor')::numeric, 0)
              is distinct from coalesce((prev->>'labor')::numeric, 0) then
          raise exception 'only an admin can change the name or price of a work on a ticket'
            using errcode = '42501';
        end if;
      end if;
    end loop;
  end if;

  delete from public.works where ticket_id = p_ticket_id;

  for w in select * from jsonb_array_elements(coalesce(works, '[]'::jsonb))
  loop
    insert into public.works (ticket_id, uid, code, name, labor, custom, position, notes)
    values (
      p_ticket_id,
      coalesce(w->>'uid', gen_random_uuid()::text),
      nullif(w->>'code',''), coalesce(w->>'name',''),
      coalesce((w->>'labor')::numeric, 0),
      coalesce((w->>'custom')::boolean, false),
      coalesce((w->>'position')::int, 0),
      nullif(w->>'notes','')
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
end $$;


ALTER FUNCTION "public"."save_ticket_works"("p_ticket_id" "uuid", "works" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."save_ticket_works"("p_ticket_id" "uuid", "works" "jsonb") IS 'Replace a ticket''s works and parts in one transaction — the delete and the re-inserts land together or not at all. A non-admin may add, remove and annotate works but may not change the name or price of one already there; that is checked against a snapshot taken before the delete, since the wipe-and-reinsert makes an edit and an insert indistinguishable at the row level. SECURITY INVOKER: the caller''s RLS is the ownership check. See docs/PRODUCTION.md §3.5.';



CREATE OR REPLACE FUNCTION "public"."stamp_closed_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  finished boolean := new.status in ('done', 'paid');
begin
  if tg_op = 'INSERT' then
    if finished then
      new.closed_at := coalesce(new.closed_at, now());
    end if;
    return new;
  end if;

  /* Only the FIRST arrival is stamped: 'done' → 'paid' is the same job
     finishing and then being paid for, and re-stamping on the second step would
     restart the clock on a debt at the moment it is settled — precisely
     backwards. Going back to open work clears it, so a job reopened for a
     comeback is not still aging against its first visit. */
  if finished and old.status not in ('done', 'paid') then
    new.closed_at := now();
  elsif not finished then
    new.closed_at := null;
  end if;
  return new;
end $$;


ALTER FUNCTION "public"."stamp_closed_at"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."stamp_closed_at"() IS 'Keeps tickets.closed_at true to the status, whichever client writes it. Set when a ticket first reaches ''done'' or ''paid'', left alone as it moves between them, cleared if it returns to open work.';



CREATE OR REPLACE FUNCTION "public"."stamp_paid_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  if tg_op = 'INSERT' then
    -- A ticket can be created already settled (an over-the-counter sale).
    if new.status = 'paid' then
      new.paid_at := coalesce(new.paid_at, now());
    end if;
  elsif new.status = 'paid' and old.status is distinct from 'paid' then
    new.paid_at := now();
  elsif new.status is distinct from 'paid' then
    -- Back out of שולם: the clock is off, and the ticket is live again.
    new.paid_at := null;
  end if;
  return new;
end $$;


ALTER FUNCTION "public"."stamp_paid_at"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."stamp_paid_at"() IS 'Keeps tickets.paid_at true to the status, whichever client writes it. Set when a ticket enters ''paid'', cleared when it leaves.';



CREATE OR REPLACE FUNCTION "public"."touch_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at := now();
  return new;
end $$;


ALTER FUNCTION "public"."touch_updated_at"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."customers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "phone" "text",
    "email" "text",
    "address" "text",
    "city" "text",
    "kind" "text" DEFAULT 'private'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "id_number" "text",
    "garage_id" "uuid" DEFAULT "public"."current_garage_id"() NOT NULL,
    CONSTRAINT "customers_kind_check" CHECK (("kind" = ANY (ARRAY['private'::"text", 'business'::"text"])))
);

ALTER TABLE ONLY "public"."customers" REPLICA IDENTITY FULL;


ALTER TABLE "public"."customers" OWNER TO "postgres";


COMMENT ON COLUMN "public"."customers"."kind" IS 'private | business. A code, not a label — the apps translate it for display. See packages/shared/src/identity.ts.';



COMMENT ON COLUMN "public"."customers"."id_number" IS 'ת״ז / company registration number. Sensitive personal data — see docs/PRODUCTION.md §6.';



CREATE TABLE IF NOT EXISTS "public"."garage_billing" (
    "garage_id" "uuid" NOT NULL,
    "provider" "text" DEFAULT 'icount'::"text" NOT NULL,
    "doc_type" "text" DEFAULT 'invoice_receipt'::"text" NOT NULL,
    "vat_rate" numeric(5,4) DEFAULT 0.18 NOT NULL,
    "active" boolean DEFAULT false NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "garage_billing_doc_type_check" CHECK (("doc_type" = ANY (ARRAY['invoice_receipt'::"text", 'tax_invoice'::"text"])))
);


ALTER TABLE "public"."garage_billing" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."garage_billing_secrets" (
    "garage_id" "uuid" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "credentials" "jsonb" NOT NULL
);


ALTER TABLE "public"."garage_billing_secrets" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."garage_counters" (
    "garage_id" "uuid" NOT NULL,
    "last_ticket" integer DEFAULT 0 NOT NULL,
    "last_job" integer DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."garage_counters" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."garage_members" (
    "garage_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "role" "text" DEFAULT 'member'::"text" NOT NULL,
    CONSTRAINT "garage_members_role_check" CHECK (("role" = ANY (ARRAY['admin'::"text", 'member'::"text"])))
);

ALTER TABLE ONLY "public"."garage_members" REPLICA IDENTITY FULL;


ALTER TABLE "public"."garage_members" OWNER TO "postgres";


COMMENT ON COLUMN "public"."garage_members"."role" IS 'admin or member. Decides who may change the name or price of a work already on a ticket; a member may still add, remove and annotate. Assigned by scripts/onboard-garage.mjs — there is no in-app role editor, so an admin cannot demote themselves by accident.';



CREATE TABLE IF NOT EXISTS "public"."garage_workers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "garage_id" "uuid" DEFAULT "public"."current_garage_id"() NOT NULL,
    "code" "text" NOT NULL,
    "name" "text" NOT NULL,
    "initials" "text" NOT NULL,
    "color" "text" DEFAULT '#3e5c76'::"text" NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "user_id" "uuid"
);

ALTER TABLE ONLY "public"."garage_workers" REPLICA IDENTITY FULL;


ALTER TABLE "public"."garage_workers" OWNER TO "postgres";


COMMENT ON TABLE "public"."garage_workers" IS 'The garage''s mechanics — a name, initials and a colour behind the code that tickets store in assignee. Readable by every member, because the board draws these on every card; written only by an admin, because deleting one orphans the assignee on every ticket that named it. Not users: nobody signs in as a worker. See garage_members for who may log in.';



COMMENT ON COLUMN "public"."garage_workers"."active" IS 'false retires a worker: hidden from pickers, still resolves on old tickets.';



COMMENT ON COLUMN "public"."garage_workers"."user_id" IS 'The login behind this worker, when there is one. NULL is a legitimate state: a mechanic who does not use the app is still assignable, and the pre-tenancy rows have no account at all. Set by the manage-staff function, which creates the account and both rows together.';



CREATE TABLE IF NOT EXISTS "public"."garages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "tax_id" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE ONLY "public"."garages" REPLICA IDENTITY FULL;


ALTER TABLE "public"."garages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."invoices" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "garage_id" "uuid" DEFAULT "public"."current_garage_id"() NOT NULL,
    "ticket_id" "uuid",
    "ticket_key" "text",
    "doc_type" "text" NOT NULL,
    "provider" "text" DEFAULT 'icount'::"text" NOT NULL,
    "provider_docnum" "text" NOT NULL,
    "allocation_number" "text",
    "provider_doc_id" "text",
    "pdf_url" "text",
    "issued_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "customer_name" "text",
    "customer_id_number" "text",
    "customer_address" "text",
    "customer_phone" "text",
    "lines" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "subtotal" numeric(12,2) NOT NULL,
    "vat_rate" numeric(5,4) NOT NULL,
    "vat" numeric(12,2) NOT NULL,
    "total" numeric(12,2) NOT NULL,
    "pay_method" "text",
    "pay_reference" "text",
    "status" "text" DEFAULT 'issued'::"text" NOT NULL,
    "cancelled_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "credits_invoice_id" "uuid",
    "pays_invoice_id" "uuid",
    CONSTRAINT "invoices_doc_type_check" CHECK (("doc_type" = ANY (ARRAY['invoice_receipt'::"text", 'tax_invoice'::"text", 'receipt'::"text", 'credit_note'::"text"]))),
    CONSTRAINT "invoices_links_match_doc_type" CHECK (((("credits_invoice_id" IS NULL) OR ("doc_type" = 'credit_note'::"text")) AND (("pays_invoice_id" IS NULL) OR ("doc_type" = 'receipt'::"text")))),
    CONSTRAINT "invoices_status_check" CHECK (("status" = ANY (ARRAY['issued'::"text", 'cancelled'::"text"])))
);

ALTER TABLE ONLY "public"."invoices" REPLICA IDENTITY FULL;


ALTER TABLE "public"."invoices" OWNER TO "postgres";


COMMENT ON COLUMN "public"."invoices"."pay_method" IS 'A code, not a label: cash | card | bit | bank_transfer | cheque | other. NULL on a document that records no payment. Mirrors tickets.pay_method; see PAY_METHODS in packages/shared/src/payment.ts.';



COMMENT ON COLUMN "public"."invoices"."credits_invoice_id" IS 'For a credit_note: the invoice_receipt it credits. Several notes may credit one invoice (partial credits); their totals may not exceed it. NULL on an invoice_receipt. The reverse link, invoices.cancelled_by, is set only when a credit takes the whole remaining amount.';



COMMENT ON COLUMN "public"."invoices"."pays_invoice_id" IS 'For a receipt: the tax_invoice it settles. Several receipts may pay one invoice; their totals may not exceed what is owed on it. NULL on every other document type.';



CREATE TABLE IF NOT EXISTS "public"."items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "sku" "text" NOT NULL,
    "name" "text" NOT NULL,
    "price" numeric(10,2) DEFAULT 0 NOT NULL,
    "stock" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "garage_id" "uuid" DEFAULT "public"."current_garage_id"() NOT NULL
);

ALTER TABLE ONLY "public"."items" REPLICA IDENTITY FULL;


ALTER TABLE "public"."items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."supplier_expenses" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "garage_id" "uuid" DEFAULT "public"."current_garage_id"() NOT NULL,
    "supplier_id" "uuid" NOT NULL,
    "expense_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "description" "text",
    "category" "text",
    "reference" "text",
    "subtotal" numeric(12,2) DEFAULT 0 NOT NULL,
    "vat_rate" numeric(5,4) DEFAULT 0.18 NOT NULL,
    "vat" numeric(12,2) DEFAULT 0 NOT NULL,
    "total" numeric(12,2) DEFAULT 0 NOT NULL,
    "paid" boolean DEFAULT false NOT NULL,
    "provider" "text" DEFAULT 'icount'::"text" NOT NULL,
    "provider_expense_id" "text",
    "sync_status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "sync_error" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "due_date" "date",
    "cheque_number" "text",
    "cheque_date" "date",
    CONSTRAINT "supplier_expenses_sync_status_check" CHECK (("sync_status" = ANY (ARRAY['pending'::"text", 'synced'::"text", 'error'::"text"])))
);


ALTER TABLE "public"."supplier_expenses" OWNER TO "postgres";


COMMENT ON COLUMN "public"."supplier_expenses"."due_date" IS 'When the supplier is owed. NULL means on receipt — the expense date is the due date. This is what ages an unpaid bill, not expense_date.';



COMMENT ON COLUMN "public"."supplier_expenses"."cheque_number" IS 'The cheque written for this bill, when it was paid by one. One cheque per expense; several against one bill would need a payments table.';



COMMENT ON COLUMN "public"."supplier_expenses"."cheque_date" IS 'The date ON the cheque, which for a post-dated one is not the day it was written and not the day the bill was due. This is the day the money leaves the account, and the day the obligo report groups by.';



CREATE TABLE IF NOT EXISTS "public"."suppliers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "garage_id" "uuid" DEFAULT "public"."current_garage_id"() NOT NULL,
    "name" "text" NOT NULL,
    "tax_id" "text",
    "phone" "text",
    "email" "text",
    "address" "text",
    "notes" "text",
    "provider_supplier_id" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."suppliers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ticket_photos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "ticket_id" "uuid" NOT NULL,
    "path" "text" NOT NULL,
    "caption" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "garage_id" "uuid" DEFAULT "public"."current_garage_id"() NOT NULL,
    "share_code" "text" DEFAULT "public"."new_photo_share_code"() NOT NULL
);

ALTER TABLE ONLY "public"."ticket_photos" REPLICA IDENTITY FULL;


ALTER TABLE "public"."ticket_photos" OWNER TO "postgres";


COMMENT ON COLUMN "public"."ticket_photos"."share_code" IS 'The token in the customer-facing link (/functions/v1/photo/<code>). A bearer credential: whoever holds it can view this one photo, which is why it is random rather than derived from the id.';



CREATE TABLE IF NOT EXISTS "public"."tickets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "key" "text" NOT NULL,
    "job" "text",
    "status" "text" DEFAULT 'todo'::"text" NOT NULL,
    "type" "text" DEFAULT 'job'::"text" NOT NULL,
    "epic" "text" DEFAULT 'service'::"text" NOT NULL,
    "priority" "text" DEFAULT 'med'::"text" NOT NULL,
    "assignee" "text",
    "points" integer DEFAULT 3 NOT NULL,
    "title" "text" NOT NULL,
    "plate" "text",
    "car" "text",
    "customer_id" "uuid",
    "customer_name" "text",
    "phone" "text",
    "email" "text",
    "address" "text",
    "km" "text",
    "year" "text",
    "amount" numeric(10,2) DEFAULT 0 NOT NULL,
    "done" integer DEFAULT 0 NOT NULL,
    "subtasks" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "flags" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "due" "text",
    "blocked" "text",
    "notes" "text",
    "paid" boolean DEFAULT false NOT NULL,
    "pay_method" "text",
    "doc" "text",
    "reference" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "id_number" "text",
    "vehicle_code" "text",
    "garage_id" "uuid" DEFAULT "public"."current_garage_id"() NOT NULL,
    "paid_at" timestamp with time zone,
    "closed_at" timestamp with time zone,
    CONSTRAINT "tickets_epic_check" CHECK (("epic" = ANY (ARRAY['brakes'::"text", 'engine'::"text", 'service'::"text", 'ac'::"text", 'susp'::"text", 'elec'::"text", 'body'::"text"]))),
    CONSTRAINT "tickets_priority_check" CHECK (("priority" = ANY (ARRAY['urgent'::"text", 'high'::"text", 'med'::"text", 'low'::"text"]))),
    CONSTRAINT "tickets_status_check" CHECK (("status" = ANY (ARRAY['todo'::"text", 'appr'::"text", 'done'::"text", 'paid'::"text"]))),
    CONSTRAINT "tickets_type_check" CHECK (("type" = ANY (ARRAY['job'::"text", 'diag'::"text", 'part'::"text", 'quote'::"text", 'test'::"text"])))
);

ALTER TABLE ONLY "public"."tickets" REPLICA IDENTITY FULL;


ALTER TABLE "public"."tickets" OWNER TO "postgres";


COMMENT ON COLUMN "public"."tickets"."status" IS 'One of four board columns: todo (כניסה), appr (ממתין לאישור), done (מוכן), paid (שולם). The ids are kept as they were so no client, export or saved link has to be rewritten — only the set shrank. See COLUMNS in packages/shared/src/types.ts, which must list exactly these four.';



COMMENT ON COLUMN "public"."tickets"."flags" IS 'Codes, not labels: new | key_received | business | blocked | ready_for_pickup | awaiting_approval | vip. See TICKET_FLAGS in packages/shared/src/intake.ts.';



COMMENT ON COLUMN "public"."tickets"."pay_method" IS 'A code, not a label: cash | card | bit | bank_transfer | cheque | other. NULL when no money has arrived. The apps translate it for display; see PAY_METHODS in packages/shared/src/payment.ts.';



COMMENT ON COLUMN "public"."tickets"."paid_at" IS 'When the ticket''s status became ''paid'', written by the tickets_stamp_paid_at trigger and cleared if it leaves that status. This is what ages a ticket off the board into the archive — NOT updated_at, which moves on every edit, and not the due date, which is a promise rather than a payment. See isArchived() in @garage/shared.';



COMMENT ON COLUMN "public"."tickets"."closed_at" IS 'When the work was finished — the ticket first reached ''done'' or ''paid''. Written by the tickets_stamp_closed_at trigger, cleared if the ticket goes back to open work. This is what ages an unpaid debt in the aging report; NOT `due`, which is free text, and not updated_at, which moves on every edit.';



CREATE TABLE IF NOT EXISTS "public"."vehicles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "customer_id" "uuid" NOT NULL,
    "plate" "text" NOT NULL,
    "manufacturer" "text",
    "model" "text",
    "year" "text",
    "km" "text",
    "vehicle_code" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "garage_id" "uuid" DEFAULT "public"."current_garage_id"() NOT NULL
);

ALTER TABLE ONLY "public"."vehicles" REPLICA IDENTITY FULL;


ALTER TABLE "public"."vehicles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."work_def_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "work_def_id" "uuid" NOT NULL,
    "garage_id" "uuid" NOT NULL,
    "sku" "text",
    "name" "text" NOT NULL,
    "qty" numeric(10,2) DEFAULT 1 NOT NULL,
    "price" numeric(10,2) DEFAULT 0 NOT NULL,
    "position" integer DEFAULT 0 NOT NULL
);

ALTER TABLE ONLY "public"."work_def_items" REPLICA IDENTITY FULL;


ALTER TABLE "public"."work_def_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."work_defs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "garage_id" "uuid" DEFAULT "public"."current_garage_id"() NOT NULL,
    "code" "text" NOT NULL,
    "name" "text" NOT NULL,
    "labor" numeric(10,2) DEFAULT 0 NOT NULL,
    "hours" numeric(10,2) DEFAULT 0 NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE ONLY "public"."work_defs" REPLICA IDENTITY FULL;


ALTER TABLE "public"."work_defs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."work_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "work_id" "uuid" NOT NULL,
    "sku" "text",
    "name" "text" NOT NULL,
    "qty" numeric(10,2) DEFAULT 1 NOT NULL,
    "price" numeric(10,2) DEFAULT 0 NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    "garage_id" "uuid" DEFAULT "public"."current_garage_id"() NOT NULL
);

ALTER TABLE ONLY "public"."work_items" REPLICA IDENTITY FULL;


ALTER TABLE "public"."work_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."works" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "ticket_id" "uuid" NOT NULL,
    "uid" "text" NOT NULL,
    "code" "text",
    "name" "text" NOT NULL,
    "labor" numeric(10,2) DEFAULT 0 NOT NULL,
    "custom" boolean DEFAULT false NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "garage_id" "uuid" DEFAULT "public"."current_garage_id"() NOT NULL,
    "notes" "text"
);

ALTER TABLE ONLY "public"."works" REPLICA IDENTITY FULL;


ALTER TABLE "public"."works" OWNER TO "postgres";


COMMENT ON COLUMN "public"."works"."notes" IS 'What was actually done, written against this work on this ticket. Any member may write it — it records labour, it does not price it. Like name and labor, it belongs to the ticket''s copy of the work and never to the work_defs entry it came from.';



ALTER TABLE ONLY "public"."customers"
    ADD CONSTRAINT "customers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."garage_billing"
    ADD CONSTRAINT "garage_billing_pkey" PRIMARY KEY ("garage_id");



ALTER TABLE ONLY "public"."garage_billing_secrets"
    ADD CONSTRAINT "garage_billing_secrets_pkey" PRIMARY KEY ("garage_id");



ALTER TABLE ONLY "public"."garage_counters"
    ADD CONSTRAINT "garage_counters_pkey" PRIMARY KEY ("garage_id");



ALTER TABLE ONLY "public"."garage_members"
    ADD CONSTRAINT "garage_members_pkey" PRIMARY KEY ("garage_id", "user_id");



ALTER TABLE ONLY "public"."garage_workers"
    ADD CONSTRAINT "garage_workers_garage_code_key" UNIQUE ("garage_id", "code");



ALTER TABLE ONLY "public"."garage_workers"
    ADD CONSTRAINT "garage_workers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."garages"
    ADD CONSTRAINT "garages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."items"
    ADD CONSTRAINT "items_garage_sku_key" UNIQUE ("garage_id", "sku");



COMMENT ON CONSTRAINT "items_garage_sku_key" ON "public"."items" IS 'Per-garage, not global. Two garages legitimately stock the same part number.';



ALTER TABLE ONLY "public"."items"
    ADD CONSTRAINT "items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."supplier_expenses"
    ADD CONSTRAINT "supplier_expenses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."suppliers"
    ADD CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ticket_photos"
    ADD CONSTRAINT "ticket_photos_path_key" UNIQUE ("path");



ALTER TABLE ONLY "public"."ticket_photos"
    ADD CONSTRAINT "ticket_photos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ticket_photos"
    ADD CONSTRAINT "ticket_photos_share_code_key" UNIQUE ("share_code");



ALTER TABLE ONLY "public"."tickets"
    ADD CONSTRAINT "tickets_garage_key_key" UNIQUE ("garage_id", "key");



ALTER TABLE ONLY "public"."tickets"
    ADD CONSTRAINT "tickets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."vehicles"
    ADD CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."work_def_items"
    ADD CONSTRAINT "work_def_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."work_defs"
    ADD CONSTRAINT "work_defs_garage_code_key" UNIQUE ("garage_id", "code");



ALTER TABLE ONLY "public"."work_defs"
    ADD CONSTRAINT "work_defs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."work_items"
    ADD CONSTRAINT "work_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."works"
    ADD CONSTRAINT "works_pkey" PRIMARY KEY ("id");



CREATE INDEX "customers_garage_id_idx" ON "public"."customers" USING "btree" ("garage_id");



CREATE UNIQUE INDEX "customers_garage_id_number_key" ON "public"."customers" USING "btree" ("garage_id", "id_number") WHERE ("id_number" IS NOT NULL);



CREATE INDEX "customers_garage_phone_idx" ON "public"."customers" USING "btree" ("garage_id", "phone") WHERE ("phone" IS NOT NULL);



CREATE INDEX "garage_members_user_id_idx" ON "public"."garage_members" USING "btree" ("user_id");



CREATE INDEX "garage_workers_garage_id_idx" ON "public"."garage_workers" USING "btree" ("garage_id");



CREATE UNIQUE INDEX "garage_workers_garage_user_key" ON "public"."garage_workers" USING "btree" ("garage_id", "user_id") WHERE ("user_id" IS NOT NULL);



CREATE INDEX "invoices_credits_invoice_id_idx" ON "public"."invoices" USING "btree" ("credits_invoice_id") WHERE ("credits_invoice_id" IS NOT NULL);



CREATE UNIQUE INDEX "invoices_garage_docnum_key" ON "public"."invoices" USING "btree" ("garage_id", "provider", "provider_docnum");



CREATE INDEX "invoices_garage_id_idx" ON "public"."invoices" USING "btree" ("garage_id");



CREATE INDEX "invoices_pays_invoice_id_idx" ON "public"."invoices" USING "btree" ("pays_invoice_id") WHERE ("pays_invoice_id" IS NOT NULL);



CREATE INDEX "invoices_ticket_id_idx" ON "public"."invoices" USING "btree" ("ticket_id");



CREATE INDEX "items_garage_id_idx" ON "public"."items" USING "btree" ("garage_id");



CREATE INDEX "supplier_expenses_cheque_date_idx" ON "public"."supplier_expenses" USING "btree" ("garage_id", "cheque_date") WHERE ("cheque_date" IS NOT NULL);



CREATE INDEX "supplier_expenses_date_idx" ON "public"."supplier_expenses" USING "btree" ("garage_id", "expense_date" DESC);



CREATE INDEX "supplier_expenses_garage_id_idx" ON "public"."supplier_expenses" USING "btree" ("garage_id");



CREATE INDEX "supplier_expenses_supplier_id_idx" ON "public"."supplier_expenses" USING "btree" ("supplier_id");



CREATE INDEX "supplier_expenses_unpaid_idx" ON "public"."supplier_expenses" USING "btree" ("garage_id", "due_date") WHERE (NOT "paid");



CREATE INDEX "suppliers_garage_id_idx" ON "public"."suppliers" USING "btree" ("garage_id");



CREATE INDEX "ticket_photos_garage_id_idx" ON "public"."ticket_photos" USING "btree" ("garage_id");



CREATE INDEX "ticket_photos_path_idx" ON "public"."ticket_photos" USING "btree" ("path");



CREATE INDEX "ticket_photos_ticket_id_idx" ON "public"."ticket_photos" USING "btree" ("ticket_id", "created_at");



CREATE INDEX "tickets_customer_id_idx" ON "public"."tickets" USING "btree" ("customer_id");



CREATE INDEX "tickets_garage_id_idx" ON "public"."tickets" USING "btree" ("garage_id");



CREATE INDEX "tickets_status_idx" ON "public"."tickets" USING "btree" ("status");



CREATE INDEX "vehicles_customer_id_idx" ON "public"."vehicles" USING "btree" ("customer_id");



CREATE UNIQUE INDEX "vehicles_customer_plate_key" ON "public"."vehicles" USING "btree" ("customer_id", "plate");



CREATE INDEX "vehicles_garage_id_idx" ON "public"."vehicles" USING "btree" ("garage_id");



CREATE INDEX "vehicles_plate_idx" ON "public"."vehicles" USING "btree" ("plate");



CREATE INDEX "work_def_items_garage_id_idx" ON "public"."work_def_items" USING "btree" ("garage_id");



CREATE INDEX "work_def_items_work_def_idx" ON "public"."work_def_items" USING "btree" ("work_def_id");



CREATE INDEX "work_defs_garage_id_idx" ON "public"."work_defs" USING "btree" ("garage_id");



CREATE INDEX "work_items_garage_id_idx" ON "public"."work_items" USING "btree" ("garage_id");



CREATE INDEX "work_items_work_id_idx" ON "public"."work_items" USING "btree" ("work_id");



CREATE INDEX "works_garage_id_idx" ON "public"."works" USING "btree" ("garage_id");



CREATE INDEX "works_ticket_id_idx" ON "public"."works" USING "btree" ("ticket_id");



CREATE OR REPLACE TRIGGER "credit_notes_within_invoice" BEFORE INSERT ON "public"."invoices" FOR EACH ROW EXECUTE FUNCTION "public"."credit_note_within_invoice"();



CREATE OR REPLACE TRIGGER "garage_members_ensure_worker" AFTER INSERT ON "public"."garage_members" FOR EACH ROW EXECUTE FUNCTION "public"."ensure_worker_for_member"();



CREATE OR REPLACE TRIGGER "invoices_immutable" BEFORE DELETE OR UPDATE ON "public"."invoices" FOR EACH ROW EXECUTE FUNCTION "public"."invoices_are_immutable"();



CREATE OR REPLACE TRIGGER "receipts_within_invoice" BEFORE INSERT ON "public"."invoices" FOR EACH ROW EXECUTE FUNCTION "public"."receipt_within_invoice"();



CREATE OR REPLACE TRIGGER "ticket_photos_inherit_garage" BEFORE INSERT OR UPDATE OF "ticket_id" ON "public"."ticket_photos" FOR EACH ROW EXECUTE FUNCTION "public"."inherit_garage_from_ticket"();



CREATE OR REPLACE TRIGGER "ticket_photos_limit" BEFORE INSERT ON "public"."ticket_photos" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_ticket_photo_limit"();



CREATE OR REPLACE TRIGGER "tickets_stamp_closed_at" BEFORE INSERT OR UPDATE ON "public"."tickets" FOR EACH ROW EXECUTE FUNCTION "public"."stamp_closed_at"();



CREATE OR REPLACE TRIGGER "tickets_stamp_paid_at" BEFORE INSERT OR UPDATE ON "public"."tickets" FOR EACH ROW EXECUTE FUNCTION "public"."stamp_paid_at"();



CREATE OR REPLACE TRIGGER "tickets_touch_updated_at" BEFORE UPDATE ON "public"."tickets" FOR EACH ROW EXECUTE FUNCTION "public"."touch_updated_at"();



CREATE OR REPLACE TRIGGER "vehicles_inherit_garage" BEFORE INSERT OR UPDATE OF "customer_id" ON "public"."vehicles" FOR EACH ROW EXECUTE FUNCTION "public"."inherit_garage_from_customer"();



CREATE OR REPLACE TRIGGER "work_def_items_inherit_garage" BEFORE INSERT OR UPDATE OF "work_def_id" ON "public"."work_def_items" FOR EACH ROW EXECUTE FUNCTION "public"."inherit_garage_from_work_def"();



CREATE OR REPLACE TRIGGER "work_items_inherit_garage" BEFORE INSERT OR UPDATE OF "work_id" ON "public"."work_items" FOR EACH ROW EXECUTE FUNCTION "public"."inherit_garage_from_work"();



CREATE OR REPLACE TRIGGER "works_inherit_garage" BEFORE INSERT OR UPDATE OF "ticket_id" ON "public"."works" FOR EACH ROW EXECUTE FUNCTION "public"."inherit_garage_from_ticket"();



ALTER TABLE ONLY "public"."customers"
    ADD CONSTRAINT "customers_garage_id_fkey" FOREIGN KEY ("garage_id") REFERENCES "public"."garages"("id");



ALTER TABLE ONLY "public"."garage_billing"
    ADD CONSTRAINT "garage_billing_garage_id_fkey" FOREIGN KEY ("garage_id") REFERENCES "public"."garages"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."garage_billing_secrets"
    ADD CONSTRAINT "garage_billing_secrets_garage_id_fkey" FOREIGN KEY ("garage_id") REFERENCES "public"."garages"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."garage_counters"
    ADD CONSTRAINT "garage_counters_garage_id_fkey" FOREIGN KEY ("garage_id") REFERENCES "public"."garages"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."garage_members"
    ADD CONSTRAINT "garage_members_garage_id_fkey" FOREIGN KEY ("garage_id") REFERENCES "public"."garages"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."garage_members"
    ADD CONSTRAINT "garage_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."garage_workers"
    ADD CONSTRAINT "garage_workers_garage_id_fkey" FOREIGN KEY ("garage_id") REFERENCES "public"."garages"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."garage_workers"
    ADD CONSTRAINT "garage_workers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_cancelled_by_fkey" FOREIGN KEY ("cancelled_by") REFERENCES "public"."invoices"("id");



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_credits_invoice_id_fkey" FOREIGN KEY ("credits_invoice_id") REFERENCES "public"."invoices"("id");



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_garage_id_fkey" FOREIGN KEY ("garage_id") REFERENCES "public"."garages"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_pays_invoice_id_fkey" FOREIGN KEY ("pays_invoice_id") REFERENCES "public"."invoices"("id");



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."items"
    ADD CONSTRAINT "items_garage_id_fkey" FOREIGN KEY ("garage_id") REFERENCES "public"."garages"("id");



ALTER TABLE ONLY "public"."supplier_expenses"
    ADD CONSTRAINT "supplier_expenses_garage_id_fkey" FOREIGN KEY ("garage_id") REFERENCES "public"."garages"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."supplier_expenses"
    ADD CONSTRAINT "supplier_expenses_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."suppliers"
    ADD CONSTRAINT "suppliers_garage_id_fkey" FOREIGN KEY ("garage_id") REFERENCES "public"."garages"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."ticket_photos"
    ADD CONSTRAINT "ticket_photos_garage_id_fkey" FOREIGN KEY ("garage_id") REFERENCES "public"."garages"("id");



ALTER TABLE ONLY "public"."ticket_photos"
    ADD CONSTRAINT "ticket_photos_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tickets"
    ADD CONSTRAINT "tickets_assignee_worker_fkey" FOREIGN KEY ("garage_id", "assignee") REFERENCES "public"."garage_workers"("garage_id", "code") ON UPDATE CASCADE ON DELETE SET NULL ("assignee");



ALTER TABLE ONLY "public"."tickets"
    ADD CONSTRAINT "tickets_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."tickets"
    ADD CONSTRAINT "tickets_garage_id_fkey" FOREIGN KEY ("garage_id") REFERENCES "public"."garages"("id");



ALTER TABLE ONLY "public"."vehicles"
    ADD CONSTRAINT "vehicles_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vehicles"
    ADD CONSTRAINT "vehicles_garage_id_fkey" FOREIGN KEY ("garage_id") REFERENCES "public"."garages"("id");



ALTER TABLE ONLY "public"."work_def_items"
    ADD CONSTRAINT "work_def_items_garage_id_fkey" FOREIGN KEY ("garage_id") REFERENCES "public"."garages"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."work_def_items"
    ADD CONSTRAINT "work_def_items_work_def_id_fkey" FOREIGN KEY ("work_def_id") REFERENCES "public"."work_defs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."work_defs"
    ADD CONSTRAINT "work_defs_garage_id_fkey" FOREIGN KEY ("garage_id") REFERENCES "public"."garages"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."work_items"
    ADD CONSTRAINT "work_items_garage_id_fkey" FOREIGN KEY ("garage_id") REFERENCES "public"."garages"("id");



ALTER TABLE ONLY "public"."work_items"
    ADD CONSTRAINT "work_items_work_id_fkey" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."works"
    ADD CONSTRAINT "works_garage_id_fkey" FOREIGN KEY ("garage_id") REFERENCES "public"."garages"("id");



ALTER TABLE ONLY "public"."works"
    ADD CONSTRAINT "works_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE CASCADE;



ALTER TABLE "public"."customers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."garage_billing" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "garage_billing_read" ON "public"."garage_billing" FOR SELECT TO "authenticated" USING (("garage_id" = ( SELECT "public"."current_garage_id"() AS "current_garage_id")));



ALTER TABLE "public"."garage_billing_secrets" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."garage_counters" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."garage_members" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "garage_members_read_own" ON "public"."garage_members" FOR SELECT TO "authenticated" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."garage_workers" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "garage_workers_read" ON "public"."garage_workers" FOR SELECT TO "authenticated" USING (("garage_id" = ( SELECT "public"."current_garage_id"() AS "current_garage_id")));



CREATE POLICY "garage_workers_write" ON "public"."garage_workers" TO "authenticated" USING ((("garage_id" = ( SELECT "public"."current_garage_id"() AS "current_garage_id")) AND "public"."is_garage_admin"())) WITH CHECK ((("garage_id" = ( SELECT "public"."current_garage_id"() AS "current_garage_id")) AND "public"."is_garage_admin"()));



ALTER TABLE "public"."garages" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "garages_read_own" ON "public"."garages" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."garage_members" "m"
  WHERE (("m"."garage_id" = "garages"."id") AND ("m"."user_id" = ( SELECT "auth"."uid"() AS "uid"))))));



ALTER TABLE "public"."invoices" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "invoices_read" ON "public"."invoices" FOR SELECT TO "authenticated" USING (("garage_id" = ( SELECT "public"."current_garage_id"() AS "current_garage_id")));



ALTER TABLE "public"."items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."supplier_expenses" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."suppliers" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "tenant_isolation" ON "public"."customers" TO "authenticated" USING (("garage_id" = ( SELECT "public"."current_garage_id"() AS "current_garage_id"))) WITH CHECK (("garage_id" = ( SELECT "public"."current_garage_id"() AS "current_garage_id")));



CREATE POLICY "tenant_isolation" ON "public"."items" TO "authenticated" USING (("garage_id" = ( SELECT "public"."current_garage_id"() AS "current_garage_id"))) WITH CHECK (("garage_id" = ( SELECT "public"."current_garage_id"() AS "current_garage_id")));



CREATE POLICY "tenant_isolation" ON "public"."supplier_expenses" TO "authenticated" USING (("garage_id" = ( SELECT "public"."current_garage_id"() AS "current_garage_id"))) WITH CHECK (("garage_id" = ( SELECT "public"."current_garage_id"() AS "current_garage_id")));



CREATE POLICY "tenant_isolation" ON "public"."suppliers" TO "authenticated" USING (("garage_id" = ( SELECT "public"."current_garage_id"() AS "current_garage_id"))) WITH CHECK (("garage_id" = ( SELECT "public"."current_garage_id"() AS "current_garage_id")));



CREATE POLICY "tenant_isolation" ON "public"."ticket_photos" TO "authenticated" USING (("garage_id" = ( SELECT "public"."current_garage_id"() AS "current_garage_id"))) WITH CHECK (("garage_id" = ( SELECT "public"."current_garage_id"() AS "current_garage_id")));



CREATE POLICY "tenant_isolation" ON "public"."tickets" TO "authenticated" USING (("garage_id" = ( SELECT "public"."current_garage_id"() AS "current_garage_id"))) WITH CHECK (("garage_id" = ( SELECT "public"."current_garage_id"() AS "current_garage_id")));



CREATE POLICY "tenant_isolation" ON "public"."vehicles" TO "authenticated" USING (("garage_id" = ( SELECT "public"."current_garage_id"() AS "current_garage_id"))) WITH CHECK (("garage_id" = ( SELECT "public"."current_garage_id"() AS "current_garage_id")));



CREATE POLICY "tenant_isolation" ON "public"."work_items" TO "authenticated" USING (("garage_id" = ( SELECT "public"."current_garage_id"() AS "current_garage_id"))) WITH CHECK (("garage_id" = ( SELECT "public"."current_garage_id"() AS "current_garage_id")));



CREATE POLICY "tenant_isolation" ON "public"."works" TO "authenticated" USING (("garage_id" = ( SELECT "public"."current_garage_id"() AS "current_garage_id"))) WITH CHECK (("garage_id" = ( SELECT "public"."current_garage_id"() AS "current_garage_id")));



ALTER TABLE "public"."ticket_photos" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."tickets" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."vehicles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."work_def_items" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "work_def_items_tenant" ON "public"."work_def_items" TO "authenticated" USING (("garage_id" = ( SELECT "public"."current_garage_id"() AS "current_garage_id"))) WITH CHECK (("garage_id" = ( SELECT "public"."current_garage_id"() AS "current_garage_id")));



ALTER TABLE "public"."work_defs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "work_defs_tenant" ON "public"."work_defs" TO "authenticated" USING (("garage_id" = ( SELECT "public"."current_garage_id"() AS "current_garage_id"))) WITH CHECK (("garage_id" = ( SELECT "public"."current_garage_id"() AS "current_garage_id")));



ALTER TABLE "public"."work_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."works" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."customers";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."garage_workers";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."items";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."ticket_photos";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."tickets";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."vehicles";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."work_defs";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."work_items";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."works";






GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";




























































































































































REVOKE ALL ON FUNCTION "public"."create_ticket"("t" "jsonb", "works" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_ticket"("t" "jsonb", "works" "jsonb") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."current_garage_id"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."current_garage_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."current_garage_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_garage_id"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."garage_staff"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."garage_staff"() TO "authenticated";



REVOKE ALL ON FUNCTION "public"."invoice_credited_total"("invoice" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."invoice_credited_total"("invoice" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."invoice_credited_total"("invoice" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."invoice_paid_total"("invoice" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."invoice_paid_total"("invoice" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."invoice_paid_total"("invoice" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_garage_admin"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_garage_admin"() TO "authenticated";



REVOKE ALL ON FUNCTION "public"."my_garages"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."my_garages"() TO "authenticated";



REVOKE ALL ON FUNCTION "public"."save_ticket_works"("p_ticket_id" "uuid", "works" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."save_ticket_works"("p_ticket_id" "uuid", "works" "jsonb") TO "authenticated";


















GRANT ALL ON TABLE "public"."customers" TO "authenticated";
GRANT ALL ON TABLE "public"."customers" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."garage_billing" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."garage_billing" TO "authenticated";
GRANT SELECT,INSERT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."garage_billing" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."garage_billing_secrets" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."garage_billing_secrets" TO "authenticated";
GRANT ALL ON TABLE "public"."garage_billing_secrets" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."garage_counters" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."garage_counters" TO "authenticated";
GRANT SELECT,INSERT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."garage_counters" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."garage_members" TO "authenticated";
GRANT ALL ON TABLE "public"."garage_members" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."garage_workers" TO "anon";
GRANT ALL ON TABLE "public"."garage_workers" TO "authenticated";
GRANT ALL ON TABLE "public"."garage_workers" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."garages" TO "authenticated";
GRANT ALL ON TABLE "public"."garages" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."invoices" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."invoices" TO "authenticated";
GRANT SELECT,INSERT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."invoices" TO "service_role";



GRANT ALL ON TABLE "public"."items" TO "authenticated";
GRANT ALL ON TABLE "public"."items" TO "service_role";



GRANT ALL ON TABLE "public"."supplier_expenses" TO "authenticated";
GRANT ALL ON TABLE "public"."supplier_expenses" TO "service_role";



GRANT ALL ON TABLE "public"."suppliers" TO "authenticated";
GRANT ALL ON TABLE "public"."suppliers" TO "service_role";



GRANT ALL ON TABLE "public"."ticket_photos" TO "authenticated";
GRANT ALL ON TABLE "public"."ticket_photos" TO "service_role";



GRANT ALL ON TABLE "public"."tickets" TO "authenticated";
GRANT ALL ON TABLE "public"."tickets" TO "service_role";



GRANT ALL ON TABLE "public"."vehicles" TO "authenticated";
GRANT ALL ON TABLE "public"."vehicles" TO "service_role";



GRANT ALL ON TABLE "public"."work_def_items" TO "authenticated";
GRANT ALL ON TABLE "public"."work_def_items" TO "service_role";



GRANT ALL ON TABLE "public"."work_defs" TO "authenticated";
GRANT ALL ON TABLE "public"."work_defs" TO "service_role";



GRANT ALL ON TABLE "public"."work_items" TO "authenticated";
GRANT ALL ON TABLE "public"."work_items" TO "service_role";



GRANT ALL ON TABLE "public"."works" TO "authenticated";
GRANT ALL ON TABLE "public"."works" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT UPDATE ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT UPDATE ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT UPDATE ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO "service_role";
































--
-- Policies on storage.objects. A dump of the public schema does not reach
-- them, and they are what scopes a garage to its own photo objects.
--

CREATE POLICY "ticket_photos_delete" ON "storage"."objects" FOR DELETE TO "authenticated" USING ((("bucket_id" = 'ticket-photos'::"text") AND (("name" ~~ ((( SELECT "public"."current_garage_id"() AS "current_garage_id"))::"text" || '/%'::"text")) OR (EXISTS ( SELECT 1
   FROM "public"."ticket_photos" "p"
  WHERE (("p"."path" = "objects"."name") AND ("p"."garage_id" = ( SELECT "public"."current_garage_id"() AS "current_garage_id"))))))));



CREATE POLICY "ticket_photos_insert" ON "storage"."objects" FOR INSERT TO "authenticated" WITH CHECK ((("bucket_id" = 'ticket-photos'::"text") AND ("name" ~~ ((( SELECT "public"."current_garage_id"() AS "current_garage_id"))::"text" || '/%'::"text"))));



CREATE POLICY "ticket_photos_read" ON "storage"."objects" FOR SELECT TO "authenticated" USING ((("bucket_id" = 'ticket-photos'::"text") AND (("name" ~~ ((( SELECT "public"."current_garage_id"() AS "current_garage_id"))::"text" || '/%'::"text")) OR (EXISTS ( SELECT 1
   FROM "public"."ticket_photos" "p"
  WHERE (("p"."path" = "objects"."name") AND ("p"."garage_id" = ( SELECT "public"."current_garage_id"() AS "current_garage_id"))))))));





-- ============================================================


-- ============================================================
--  Post-squash restoration
--
--  pg_dump reproduces schema, not rows, and not every ACL delta. Two things the
--  eighteen migrations established that a dump of the result does not carry, and
--  that a fresh database therefore has to be told again:
--
--  1. The `ticket-photos` bucket. `storage.buckets` is a table, so the bucket is
--     a *row* — invisible to a schema dump. The three storage policies above
--     survived and reference a bucket that would not exist without this, so an
--     upload would fail against a policy that looks perfectly correct.
--     Created private: photos are served through signed URLs and through the
--     `photo` Edge Function, never from a public bucket.
--
--  2. Table privileges that are absences rather than grants. The dump writes out
--     the GRANTs an object has; it cannot write out the ones it was denied,
--     because a fresh database re-applies the platform's default ACL at CREATE
--     TABLE time and the dump's GRANT lines only ever add. So `revoke` has to be
--     re-run here, after the tables exist.
--
--     The list below is deliberately the one the previous baseline carried,
--     thirteen tables and `anon` only — NOT the complete one. This file must
--     reproduce what the eighteen migrations produced and nothing else: it
--     carries a version every environment has already applied, so anything extra
--     in it would be a change that reaches a fresh database and never reaches
--     staging or production. The list is incomplete, and it is fixed one
--     migration later by 20260811010000_pre_launch_hardening.sql, which revokes
--     the same three privileges from `authenticated` too, does it by looping
--     over pg_tables so no future table can be forgotten, and sets the default
--     privileges so tables that do not exist yet never receive them.
--
--     Fold that migration into this file the next time everything is deployed
--     everywhere and the list here can go.
--
--  Verified by fingerprint diff against the eighteen migrations: identical.
--  Do that again, not an eyeball pass, if you ever squash again.
-- ============================================================

insert into storage.buckets (id, name, public)
values ('ticket-photos', 'ticket-photos', false)
on conflict (id) do nothing;

revoke all on public.customers         from anon;
revoke all on public.garage_members    from anon;
revoke all on public.garages           from anon;
revoke all on public.items             from anon;
revoke all on public.supplier_expenses from anon;
revoke all on public.suppliers         from anon;
revoke all on public.ticket_photos     from anon;
revoke all on public.tickets           from anon;
revoke all on public.vehicles          from anon;
revoke all on public.work_def_items    from anon;
revoke all on public.work_defs         from anon;
revoke all on public.work_items        from anon;
revoke all on public.works             from anon;
