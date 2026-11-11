-- Customers and cars are searched in the database, a page at a time.
--
-- Until now every screen that offers a customer — the intake search, "switch
-- customer", the customers and cars lists — loaded the whole table and filtered
-- it in the browser. PostgREST hands out at most 1000 rows a request, so a
-- garage past 1000 customers (2026-11-10: one imported 10,690) silently could
-- not find most of them, and every visit to those screens moved megabytes.
--
-- Two functions answer the same questions the screens used to answer in
-- memory, with the same matching rules, and return one page:
--
--   search_customers   name, email, ת״ז, city; phone by its digits; or the
--                      plate of one of their cars.
--   search_cars        plate (by plate_key); manufacturer / model; an owner's
--                      name.
--
-- Both are SECURITY INVOKER: RLS scopes them to the caller's garage exactly as
-- a plain select would. They return the table's own row type, so PostgREST can
-- embed relations on the result (search_customers → vehicles), and page and
-- count it the usual way (Range + count=exact) — paging is applied outside the
-- function, so the count is of every match, not of one page. Plain SQL bodies,
-- so the planner inlines them and the LIMIT reaches the scan.
-- An empty query lists everything, newest first.

create extension if not exists pg_trgm with schema extensions;

-- "contains" searches: trigram indexes make '%…%' an index scan.
create index if not exists customers_name_trgm
  on public.customers using gin (lower(name) extensions.gin_trgm_ops);
create index if not exists customers_phone_trgm
  on public.customers using gin (public.phone_key(phone) extensions.gin_trgm_ops);
create index if not exists cars_plate_key_trgm
  on public.cars using gin (plate_key extensions.gin_trgm_ops);
-- "who holds this number": exact, for the duplicate-phone warning.
create index if not exists customers_garage_phone_key_idx
  on public.customers (garage_id, public.phone_key(phone));

-- A typed % or _ is a character, not a wildcard.
create or replace function public.like_escape(s text) returns text
language sql immutable
set search_path = ''
as $$ select replace(replace(replace(coalesce(s, ''), '\', '\\'), '%', '\%'), '_', '\_') $$;

create or replace function public.search_customers(q text default '')
returns setof public.customers
language sql stable
security invoker
set search_path = ''
as $$
  with k as (
    select btrim(coalesce(q, '')) as t,
           '%' || lower(public.like_escape(btrim(coalesce(q, '')))) || '%' as l,
           public.phone_key(q) as d,
           public.plate_key(q) as p
  ),
  -- Each way of matching on its own, so each can use its own index; an OR
  -- across them (with the plate's sub-select) left the planner a full scan.
  hit as (
    select c.id from public.customers c, k where k.t <> '' and lower(c.name) like k.l
    union
    select c.id from public.customers c, k where k.t <> '' and lower(c.email) like k.l
    union
    select c.id from public.customers c, k where k.t <> '' and lower(c.city) like k.l
    union
    select c.id from public.customers c, k where k.t <> '' and c.id_number like k.l
    union
    select c.id from public.customers c, k
     where length(k.d) >= 3 and public.phone_key(c.phone) like '%' || k.d || '%'
    union
    select v.customer_id from public.cars car join public.vehicles v on v.car_id = car.id, k
     where length(k.p) >= 3 and car.plate_key like '%' || k.p || '%'
  )
  select c.*
    from public.customers c, k
   where k.t = '' or c.id in (select id from hit)
   order by
     -- the exact hit first: the whole phone, the ת״ז, the name as typed
     (k.t <> '' and (public.phone_key(c.phone) = k.d or c.id_number = k.t or lower(c.name) = lower(k.t))) desc,
     (k.t <> '' and lower(c.name) like lower(public.like_escape(k.t)) || '%') desc,
     case when k.t = '' then c.created_at end desc,
     c.name, c.id
$$;

comment on function public.search_customers(text) is
  'The garage''s customers matching q — name, email, ת״ז, city, phone digits (3+), or a car''s plate (3+). Empty q lists all, newest first. RLS-scoped (invoker). See 20261110120000_search_customers_and_cars.sql.';

create or replace function public.search_cars(q text default '')
returns setof public.cars
language sql stable
security invoker
set search_path = ''
as $$
  with k as (
    select btrim(coalesce(q, '')) as t,
           '%' || lower(public.like_escape(btrim(coalesce(q, '')))) || '%' as l,
           public.plate_key(q) as p
  ),
  hit as (
    select car.id from public.cars car, k where k.p <> '' and car.plate_key like '%' || k.p || '%'
    union
    select car.id from public.cars car, k
     where k.t <> '' and (lower(car.manufacturer) like k.l or lower(car.model) like k.l)
    union
    select v.car_id from public.customers c join public.vehicles v on v.customer_id = c.id, k
     where k.t <> '' and lower(c.name) like k.l
  )
  select car.*
    from public.cars car, k
   where k.t = '' or car.id in (select id from hit)
   order by
     (k.p <> '' and car.plate_key = k.p) desc,
     case when k.t = '' then car.created_at end desc,
     car.plate_key, car.id
$$;

comment on function public.search_cars(text) is
  'The garage''s cars matching q — plate (by plate_key), manufacturer, model, or an owner''s name. Empty q lists all, newest first. RLS-scoped (invoker).';

grant execute on function public.search_customers(text) to authenticated, service_role;
grant execute on function public.search_cars(text) to authenticated, service_role;
revoke execute on function public.search_customers(text) from anon, public;
revoke execute on function public.search_cars(text) from anon, public;
