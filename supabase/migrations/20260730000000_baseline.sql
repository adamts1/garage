


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
  cust_name   text := nullif(t->>'customer_name', '');
  v_id_number text := nullif(t->>'id_number', '');
  v_phone     text := nullif(t->>'phone', '');
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


ALTER FUNCTION "public"."create_ticket"("t" "jsonb", "works" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."create_ticket"("t" "jsonb", "works" "jsonb") IS 'Atomic new-ticket path: assigns GAR-/W- numbers under a per-garage row lock, resolves the customer, and inserts the ticket with its works and parts in one transaction. Garage comes from current_garage_id(), never the payload. See docs/PRODUCTION.md §3.4, §3.5.';



CREATE OR REPLACE FUNCTION "public"."current_garage_id"() RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select garage_id
  from public.garage_members
  where user_id = auth.uid()
  limit 1
$$;


ALTER FUNCTION "public"."current_garage_id"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."current_garage_id"() IS 'The garage the current user belongs to, or NULL when unauthenticated. Since 2c this is also the DEFAULT for garage_id on every tenant table, so an unauthenticated insert fails NOT NULL rather than landing in the backfill tenant. LIMIT 1: multi-garage membership needs an explicit chooser, not an arbitrary row. See docs/PRODUCTION.md §4.';



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


CREATE OR REPLACE FUNCTION "public"."my_garages"() RETURNS TABLE("garage_id" "uuid", "garage_name" "text")
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$
  select g.id, g.name
  from public.garages g
  join public.garage_members m on m.garage_id = g.id
  where m.user_id = (select auth.uid())
  order by g.name
$$;


ALTER FUNCTION "public"."my_garages"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."my_garages"() IS 'Garages the current user belongs to. Empty for anon and for a user with no membership — the login gate must treat both as "cannot proceed". See docs/PRODUCTION.md §5 Phase 2b.';



CREATE OR REPLACE FUNCTION "public"."save_ticket_works"("p_ticket_id" "uuid", "works" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  w   jsonb;
  wid uuid;
  p   jsonb;
begin
  -- Refuse to touch a ticket the caller cannot see. Without this the delete
  -- below would simply affect zero rows for someone else's ticket, which is
  -- safe but silent; a clear error is better than a no-op that looks like
  -- success.
  if not exists (select 1 from public.tickets where id = p_ticket_id) then
    raise exception 'ticket not found or not in your garage' using errcode = '42501';
  end if;

  delete from public.works where ticket_id = p_ticket_id;

  for w in select * from jsonb_array_elements(coalesce(works, '[]'::jsonb))
  loop
    insert into public.works (ticket_id, uid, code, name, labor, custom, position)
    values (
      p_ticket_id,
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
end $$;


ALTER FUNCTION "public"."save_ticket_works"("p_ticket_id" "uuid", "works" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."save_ticket_works"("p_ticket_id" "uuid", "works" "jsonb") IS 'Replace a ticket''s works and parts in one transaction — the delete and the re-inserts land together or not at all. SECURITY INVOKER: the caller''s RLS is the ownership check. See docs/PRODUCTION.md §3.5.';



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
    "kind" "text" DEFAULT 'פרטי'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "id_number" "text",
    "garage_id" "uuid" DEFAULT "public"."current_garage_id"() NOT NULL
);

ALTER TABLE ONLY "public"."customers" REPLICA IDENTITY FULL;


ALTER TABLE "public"."customers" OWNER TO "postgres";


COMMENT ON COLUMN "public"."customers"."id_number" IS 'ת״ז / company registration number. Sensitive personal data — see docs/PRODUCTION.md §6.';



CREATE TABLE IF NOT EXISTS "public"."garage_billing" (
    "garage_id" "uuid" NOT NULL,
    "provider" "text" DEFAULT 'icount'::"text" NOT NULL,
    "doc_type" "text" DEFAULT 'invoice_receipt'::"text" NOT NULL,
    "vat_rate" numeric(5,4) DEFAULT 0.18 NOT NULL,
    "active" boolean DEFAULT false NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "garage_billing_doc_type_check" CHECK (("doc_type" = 'invoice_receipt'::"text"))
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
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE ONLY "public"."garage_members" REPLICA IDENTITY FULL;


ALTER TABLE "public"."garage_members" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."garage_workers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "garage_id" "uuid" DEFAULT "public"."current_garage_id"() NOT NULL,
    "code" "text" NOT NULL,
    "name" "text" NOT NULL,
    "initials" "text" NOT NULL,
    "color" "text" DEFAULT '#3e5c76'::"text" NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE ONLY "public"."garage_workers" REPLICA IDENTITY FULL;


ALTER TABLE "public"."garage_workers" OWNER TO "postgres";


COMMENT ON COLUMN "public"."garage_workers"."active" IS 'false retires a worker: hidden from pickers, still resolves on old tickets.';



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
    CONSTRAINT "invoices_doc_type_check" CHECK (("doc_type" = ANY (ARRAY['invoice_receipt'::"text", 'credit_note'::"text"]))),
    CONSTRAINT "invoices_status_check" CHECK (("status" = ANY (ARRAY['issued'::"text", 'cancelled'::"text"])))
);

ALTER TABLE ONLY "public"."invoices" REPLICA IDENTITY FULL;


ALTER TABLE "public"."invoices" OWNER TO "postgres";


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
    CONSTRAINT "supplier_expenses_sync_status_check" CHECK (("sync_status" = ANY (ARRAY['pending'::"text", 'synced'::"text", 'error'::"text"])))
);


ALTER TABLE "public"."supplier_expenses" OWNER TO "postgres";


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
    "garage_id" "uuid" DEFAULT "public"."current_garage_id"() NOT NULL
);

ALTER TABLE ONLY "public"."ticket_photos" REPLICA IDENTITY FULL;


ALTER TABLE "public"."ticket_photos" OWNER TO "postgres";


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
    CONSTRAINT "tickets_epic_check" CHECK (("epic" = ANY (ARRAY['brakes'::"text", 'engine'::"text", 'service'::"text", 'ac'::"text", 'susp'::"text", 'elec'::"text", 'body'::"text"]))),
    CONSTRAINT "tickets_priority_check" CHECK (("priority" = ANY (ARRAY['urgent'::"text", 'high'::"text", 'med'::"text", 'low'::"text"]))),
    CONSTRAINT "tickets_status_check" CHECK (("status" = ANY (ARRAY['todo'::"text", 'diag'::"text", 'appr'::"text", 'prog'::"text", 'parts'::"text", 'qa'::"text", 'done'::"text", 'paid'::"text"]))),
    CONSTRAINT "tickets_type_check" CHECK (("type" = ANY (ARRAY['job'::"text", 'diag'::"text", 'part'::"text", 'quote'::"text", 'test'::"text"])))
);

ALTER TABLE ONLY "public"."tickets" REPLICA IDENTITY FULL;


ALTER TABLE "public"."tickets" OWNER TO "postgres";


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
    "garage_id" "uuid" DEFAULT "public"."current_garage_id"() NOT NULL
);

ALTER TABLE ONLY "public"."works" REPLICA IDENTITY FULL;


ALTER TABLE "public"."works" OWNER TO "postgres";


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



CREATE UNIQUE INDEX "invoices_garage_docnum_key" ON "public"."invoices" USING "btree" ("garage_id", "provider", "provider_docnum");



CREATE INDEX "invoices_garage_id_idx" ON "public"."invoices" USING "btree" ("garage_id");



CREATE INDEX "invoices_ticket_id_idx" ON "public"."invoices" USING "btree" ("ticket_id");



CREATE INDEX "items_garage_id_idx" ON "public"."items" USING "btree" ("garage_id");



CREATE INDEX "supplier_expenses_date_idx" ON "public"."supplier_expenses" USING "btree" ("garage_id", "expense_date" DESC);



CREATE INDEX "supplier_expenses_garage_id_idx" ON "public"."supplier_expenses" USING "btree" ("garage_id");



CREATE INDEX "supplier_expenses_supplier_id_idx" ON "public"."supplier_expenses" USING "btree" ("supplier_id");



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



CREATE OR REPLACE TRIGGER "invoices_immutable" BEFORE DELETE OR UPDATE ON "public"."invoices" FOR EACH ROW EXECUTE FUNCTION "public"."invoices_are_immutable"();



CREATE OR REPLACE TRIGGER "ticket_photos_inherit_garage" BEFORE INSERT OR UPDATE OF "ticket_id" ON "public"."ticket_photos" FOR EACH ROW EXECUTE FUNCTION "public"."inherit_garage_from_ticket"();



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



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_cancelled_by_fkey" FOREIGN KEY ("cancelled_by") REFERENCES "public"."invoices"("id");



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_garage_id_fkey" FOREIGN KEY ("garage_id") REFERENCES "public"."garages"("id") ON DELETE RESTRICT;



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


CREATE POLICY "garage_workers_tenant" ON "public"."garage_workers" TO "authenticated" USING (("garage_id" = ( SELECT "public"."current_garage_id"() AS "current_garage_id"))) WITH CHECK (("garage_id" = ( SELECT "public"."current_garage_id"() AS "current_garage_id")));



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



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."items";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."ticket_photos";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."tickets";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."vehicles";



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
-- Dumped schema changes for auth and storage
--

CREATE POLICY "ticket_photos_delete" ON "storage"."objects" FOR DELETE TO "authenticated" USING ((("bucket_id" = 'ticket-photos'::"text") AND (("name" ~~ ((( SELECT "public"."current_garage_id"() AS "current_garage_id"))::"text" || '/%'::"text")) OR (EXISTS ( SELECT 1
   FROM "public"."ticket_photos" "p"
  WHERE (("p"."path" = "objects"."name") AND ("p"."garage_id" = ( SELECT "public"."current_garage_id"() AS "current_garage_id"))))))));



CREATE POLICY "ticket_photos_insert" ON "storage"."objects" FOR INSERT TO "authenticated" WITH CHECK ((("bucket_id" = 'ticket-photos'::"text") AND ("name" ~~ ((( SELECT "public"."current_garage_id"() AS "current_garage_id"))::"text" || '/%'::"text"))));



CREATE POLICY "ticket_photos_read" ON "storage"."objects" FOR SELECT TO "authenticated" USING ((("bucket_id" = 'ticket-photos'::"text") AND (("name" ~~ ((( SELECT "public"."current_garage_id"() AS "current_garage_id"))::"text" || '/%'::"text")) OR (EXISTS ( SELECT 1
   FROM "public"."ticket_photos" "p"
  WHERE (("p"."path" = "objects"."name") AND ("p"."garage_id" = ( SELECT "public"."current_garage_id"() AS "current_garage_id"))))))));





-- ============================================================
--  Post-squash restoration
--
--  pg_dump reproduces schema, not data, and not every ACL delta. Two things
--  the squash dropped that the 22 migrations it replaces had established, and
--  that a fresh database therefore has to be told again:
--
--  1. The `ticket-photos` bucket. `storage.buckets` is a table, so the bucket
--     is a *row* — invisible to a schema dump. The three storage policies
--     above survived and reference a bucket that would not exist without
--     this, so uploads would fail with a policy that looks correct.
--     It is created private: 20260723030000 made it so, and photos are
--     served through signed URLs.
--
--  2. anon's inherited table privileges. 20260722020000 / 20260722030000 /
--     20260723010000 revoked REFERENCES, TRIGGER and TRUNCATE from anon on
--     every tenant table — grants the tables never got from a migration but
--     inherited from the platform's default ACL. The dump records only the
--     deltas it can see against those same defaults, so the revokes vanished
--     and a rebuilt database hands anon TRUNCATE on customers and tickets.
--     RLS does not gate TRUNCATE.
--
--  Verified by diffing a catalogue fingerprint (columns, constraints,
--  indexes, policies, functions, triggers, grants, buckets, publications)
--  of a database built from the 22 migrations against one built from this
--  file. These were the only two differences.
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
