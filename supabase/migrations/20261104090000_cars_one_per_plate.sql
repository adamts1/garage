-- History is per car. One plate is one car, with one set of details, however
-- many customers drive it.
--
-- Until now `vehicles` held a row per (customer, plate): the same car belonged
-- to a husband and to a wife as two rows that could disagree — a model on one,
-- a year on the other — and nothing tied a ticket to a car at all, only to a
-- plate typed into it. The requirement (2026-11-04) is the opposite: a car's
-- history is every work order for its plate, and a plate cannot appear on work
-- orders under different car details. Customers and cars are many-to-many.
--
-- 1. `cars` — one row per plate per garage, the car's details live here.
--    Plates are compared on letters and digits only (`plate_key`), so
--    "12-345-67" and "1234567" are one car.
--
-- 2. `vehicles` stays, and becomes the customer↔car link. Its detail columns
--    are kept, mirrored from the car, because the phone build in the App Store
--    reads them straight off this table; it keeps working without a release.
--    A write to a vehicles row merges into the car (a supplied value wins, a
--    blank keeps what was known — create_ticket's rule), and the car's details
--    are copied back to every owner's row.
--
-- 3. `tickets.car_id` — which car a work order was for, resolved from its plate
--    by the database, never sent by a client. A new ticket inherits what the
--    car already knows for whatever the form left blank.
--
-- 4. One car, one description, on every OPEN ticket. Changing the model text,
--    year or vehicle code on one ticket — or on the car — rewrites the other
--    open tickets of that car. Billed and cancelled tickets keep what was
--    printed: their documents cannot change, so neither can they. The km is a
--    reading from that day and is never copied between tickets.
--
-- 5. A customer's details, corrected anywhere, reach that customer's open
--    tickets the same way. Same exception for billed and cancelled ones.
--
-- Existing data: blanks between rows of one plate are merged. A real conflict
-- — two different makes, models, years or codes for one plate — stops the
-- migration and names the plates, rather than picking a winner. (Production
-- had none on 2026-11-04; one plate was shared, by blanks only.)

-- ---------------------------------------------------------------------------
-- 0. helpers

create or replace function public.plate_key(p text) returns text
    language sql immutable
    set search_path to ''
    as $$ select regexp_replace(lower(coalesce(p, '')), '[^0-9a-zא-ת]', '', 'g') $$;

comment on function public.plate_key(text) is
  'A plate as compared: letters and digits only, lower-cased. Mirrors plateKey in packages/shared/src/identity.ts.';

-- Open = may still change: not cancelled, and no live bill.
create or replace function public.ticket_is_open(p_ticket_id uuid, p_status text) returns boolean
    language sql stable security definer
    set search_path to ''
    as $$
  select p_status <> 'cancelled'
     and not exists (
       select 1 from public.invoices
        where ticket_id = p_ticket_id
          and doc_type in ('invoice_receipt', 'tax_invoice')
          and status = 'issued')
$$;

alter function public.ticket_is_open(uuid, text) owner to postgres;

-- "Kia Niro 2022", or '-' — carLabel in packages/shared/src/intake.ts.
create or replace function public.car_label(manufacturer text, model text, year text) returns text
    language sql immutable
    set search_path to ''
    as $$ select coalesce(nullif(concat_ws(' ', nullif(manufacturer, ''), nullif(model, ''), nullif(year, '')), ''), '-') $$;

-- ---------------------------------------------------------------------------
-- 1. cars

create table if not exists public.cars (
    id           uuid default gen_random_uuid() primary key,
    garage_id    uuid not null default public.current_garage_id() references public.garages(id),
    plate        text not null,
    plate_key    text generated always as (public.plate_key(plate)) stored,
    manufacturer text,
    model        text,
    year         text,
    km           text,
    vehicle_code text,
    created_at   timestamptz not null default now(),
    constraint cars_plate_present check (plate_key <> '')
);

create unique index if not exists cars_garage_plate_key on public.cars (garage_id, plate_key);

comment on table public.cars is
  'One car per plate per garage, and its details. Customers reach it through vehicles (many-to-many); tickets through tickets.car_id. See 20261104090000_cars_one_per_plate.sql.';
comment on column public.cars.km is
  'The latest reading known. Each ticket keeps its own reading from that visit.';

alter table public.cars replica identity full;
alter table public.cars owner to postgres;
alter table public.cars enable row level security;

create policy tenant_isolation on public.cars to authenticated
  using (garage_id = (select public.current_garage_id()))
  with check (garage_id = (select public.current_garage_id()));

grant all on table public.cars to authenticated;
grant all on table public.cars to service_role;
revoke all on public.cars from anon;

alter publication supabase_realtime add table only public.cars;

alter table public.vehicles add column if not exists car_id uuid references public.cars(id);
alter table public.tickets  add column if not exists car_id uuid references public.cars(id) on delete set null;

create index if not exists vehicles_car_id_idx on public.vehicles (car_id);
create index if not exists tickets_car_id_idx  on public.tickets (car_id);

comment on column public.tickets.car_id is
  'The car this work order was for. Resolved from plate by tickets_resolve_car; not written by clients.';

-- ---------------------------------------------------------------------------
-- 1b. backfill — triggers off, so a cancelled ticket can be stamped with its car
--     (tickets_guard_lifecycle freezes those against any other write).

set session_replication_role = replica;

do $$
declare
  bad text;
begin
  select string_agg(plate, ', ' order by plate) into bad
    from (
      select min(v.plate) as plate
        from public.vehicles v
       where public.plate_key(v.plate) <> ''
       group by v.garage_id, public.plate_key(v.plate)
      having count(distinct nullif(btrim(v.manufacturer), '')) > 1
          or count(distinct nullif(btrim(v.model), ''))        > 1
          or count(distinct nullif(btrim(v.year), ''))         > 1
          or count(distinct nullif(btrim(v.vehicle_code), '')) > 1
    ) conflicts;
  if bad is not null then
    raise exception 'plates with conflicting car details, resolve them first: %', bad;
  end if;
end $$;

-- One car per plate, from its vehicles rows. Blanks merge; the km is the most
-- recent row's.
insert into public.cars (garage_id, plate, manufacturer, model, year, km, vehicle_code, created_at)
select distinct on (v.garage_id, public.plate_key(v.plate))
       v.garage_id, btrim(v.plate),
       max(nullif(btrim(v.manufacturer), '')) over w,
       max(nullif(btrim(v.model), ''))        over w,
       max(nullif(btrim(v.year), ''))         over w,
       first_value(nullif(btrim(v.km), '')) over (partition by v.garage_id, public.plate_key(v.plate)
                                                  order by (nullif(btrim(v.km), '') is null), v.created_at desc),
       max(nullif(btrim(v.vehicle_code), '')) over w,
       min(v.created_at) over w
  from public.vehicles v
 where public.plate_key(v.plate) <> ''
window w as (partition by v.garage_id, public.plate_key(v.plate))
 order by v.garage_id, public.plate_key(v.plate), v.created_at
on conflict (garage_id, plate_key) do nothing;

-- Plates that only ever appeared on a ticket (no customer record behind it).
insert into public.cars (garage_id, plate, created_at)
select distinct on (t.garage_id, public.plate_key(t.plate))
       t.garage_id, btrim(t.plate), t.created_at
  from public.tickets t
 where public.plate_key(t.plate) <> ''
 order by t.garage_id, public.plate_key(t.plate), t.created_at
on conflict (garage_id, plate_key) do nothing;

update public.vehicles v
   set car_id = c.id,
       manufacturer = c.manufacturer, model = c.model, year = c.year,
       km = c.km, vehicle_code = c.vehicle_code
  from public.cars c
 where c.garage_id = v.garage_id and c.plate_key = public.plate_key(v.plate);

update public.tickets t
   set car_id = c.id
  from public.cars c
 where c.garage_id = t.garage_id and c.plate_key = public.plate_key(t.plate);

-- One link per customer and car: "12-345-67" and "1234567" on one customer
-- were one car typed twice. The details are on the car now; the extra row goes.
delete from public.vehicles v
 using public.vehicles keep
 where keep.customer_id = v.customer_id
   and keep.car_id = v.car_id
   and (keep.created_at, keep.id) < (v.created_at, v.id);

set session_replication_role = origin;

alter table public.vehicles alter column car_id set not null;
create unique index if not exists vehicles_customer_car_key on public.vehicles (customer_id, car_id);

comment on table public.vehicles is
  'The customer↔car link (many-to-many). The detail columns mirror cars and are kept for clients that read them here. See 20261104090000_cars_one_per_plate.sql.';

-- ---------------------------------------------------------------------------
-- 2. a vehicles write merges into its car

create or replace function public.vehicles_follow_car() returns trigger
    language plpgsql security definer
    set search_path to ''
    as $$
declare
  g uuid;
  c public.cars;
begin
  select garage_id into g from public.customers where id = new.customer_id;
  if g is null then
    raise exception 'customer not found' using errcode = '23503';
  end if;
  if public.plate_key(new.plate) = '' then
    raise exception 'a vehicle needs a plate' using errcode = '23502';
  end if;

  insert into public.cars as car (garage_id, plate, manufacturer, model, year, km, vehicle_code)
  values (g, btrim(new.plate),
          nullif(btrim(new.manufacturer), ''), nullif(btrim(new.model), ''),
          nullif(btrim(new.year), ''), nullif(btrim(new.km), ''), nullif(btrim(new.vehicle_code), ''))
  on conflict (garage_id, plate_key) do update set
    manufacturer = coalesce(excluded.manufacturer, car.manufacturer),
    model        = coalesce(excluded.model,        car.model),
    year         = coalesce(excluded.year,         car.year),
    km           = coalesce(excluded.km,           car.km),
    vehicle_code = coalesce(excluded.vehicle_code, car.vehicle_code)
  where (car.manufacturer, car.model, car.year, car.km, car.vehicle_code)
        is distinct from
        (coalesce(excluded.manufacturer, car.manufacturer), coalesce(excluded.model, car.model),
         coalesce(excluded.year, car.year), coalesce(excluded.km, car.km),
         coalesce(excluded.vehicle_code, car.vehicle_code));

  select * into c from public.cars where garage_id = g and plate_key = public.plate_key(new.plate);

  -- Already linked under another spelling of the plate: that row is the link.
  if tg_op = 'INSERT' and exists (
    select 1 from public.vehicles where customer_id = new.customer_id and car_id = c.id
  ) then
    return null;
  end if;

  new.car_id       := c.id;
  new.manufacturer := c.manufacturer;
  new.model        := c.model;
  new.year         := c.year;
  new.km           := c.km;
  new.vehicle_code := c.vehicle_code;
  return new;
end $$;

alter function public.vehicles_follow_car() owner to postgres;

drop trigger if exists vehicles_follow_car on public.vehicles;
create trigger vehicles_follow_car
  before insert or update on public.vehicles
  for each row execute function public.vehicles_follow_car();

-- ---------------------------------------------------------------------------
-- 2b + 4. a car's details reach every owner's row and every open ticket

create or replace function public.cars_propagate() returns trigger
    language plpgsql security definer
    set search_path to ''
    as $$
begin
  update public.vehicles
     set manufacturer = new.manufacturer, model = new.model, year = new.year,
         km = new.km, vehicle_code = new.vehicle_code
   where car_id = new.id
     and (manufacturer, model, year, km, vehicle_code)
         is distinct from (new.manufacturer, new.model, new.year, new.km, new.vehicle_code);

  if (new.manufacturer, new.model, new.year, new.vehicle_code)
     is distinct from (old.manufacturer, old.model, old.year, old.vehicle_code) then
    update public.tickets t
       set car = case
                   when (new.manufacturer, new.model) is distinct from (old.manufacturer, old.model)
                     or (new.year is distinct from old.year and t.car = public.car_label(old.manufacturer, old.model, old.year))
                   then public.car_label(new.manufacturer, new.model, new.year)
                   else t.car end,
           year = coalesce(new.year, t.year),
           vehicle_code = coalesce(new.vehicle_code, t.vehicle_code)
     where t.car_id = new.id
       and public.ticket_is_open(t.id, t.status);
  end if;
  return new;
end $$;

alter function public.cars_propagate() owner to postgres;

drop trigger if exists cars_propagate on public.cars;
create trigger cars_propagate
  after update on public.cars
  for each row execute function public.cars_propagate();

-- ---------------------------------------------------------------------------
-- 3. a ticket's car, from its plate

create or replace function public.tickets_resolve_car() returns trigger
    language plpgsql security definer
    set search_path to ''
    as $$
declare
  c public.cars;
begin
  if public.plate_key(new.plate) = '' then
    new.car_id := null;
    return new;
  end if;

  insert into public.cars (garage_id, plate) values (new.garage_id, btrim(new.plate))
  on conflict (garage_id, plate_key) do nothing;
  select * into c from public.cars where garage_id = new.garage_id and plate_key = public.plate_key(new.plate);
  new.car_id := c.id;

  -- A new work order says what the car already is, for whatever the form left
  -- blank.
  if tg_op = 'INSERT' then
    if coalesce(nullif(btrim(new.car), ''), '-') = '-' then
      new.car := public.car_label(c.manufacturer, c.model, c.year);
    end if;
    new.year         := coalesce(nullif(new.year, ''), c.year);
    new.vehicle_code := coalesce(nullif(new.vehicle_code, ''), c.vehicle_code);
  end if;
  return new;
end $$;

alter function public.tickets_resolve_car() owner to postgres;

drop trigger if exists tickets_resolve_car on public.tickets;
create trigger tickets_resolve_car
  before insert or update of plate, car_id on public.tickets
  for each row execute function public.tickets_resolve_car();

-- ---------------------------------------------------------------------------
-- 4. one description per car on every open ticket

create or replace function public.tickets_share_car_details() returns trigger
    language plpgsql security definer
    set search_path to ''
    as $$
begin
  -- The copies below fire this again; one level is the whole job.
  if pg_trigger_depth() > 1 or new.car_id is null then
    return null;
  end if;
  if tg_op = 'UPDATE'
     and (new.car, new.year, new.vehicle_code, new.car_id)
         is not distinct from (old.car, old.year, old.vehicle_code, old.car_id) then
    return null;
  end if;

  update public.tickets t
     set car          = coalesce(nullif(nullif(btrim(new.car), ''), '-'), t.car),
         year         = coalesce(nullif(new.year, ''), t.year),
         vehicle_code = coalesce(nullif(new.vehicle_code, ''), t.vehicle_code)
   where t.car_id = new.car_id
     and t.id <> new.id
     and public.ticket_is_open(t.id, t.status)
     and (t.car, t.year, t.vehicle_code) is distinct from
         (coalesce(nullif(nullif(btrim(new.car), ''), '-'), t.car),
          coalesce(nullif(new.year, ''), t.year),
          coalesce(nullif(new.vehicle_code, ''), t.vehicle_code));
  return null;
end $$;

alter function public.tickets_share_car_details() owner to postgres;

drop trigger if exists tickets_share_car_details on public.tickets;
create trigger tickets_share_car_details
  after insert or update of car, year, vehicle_code, car_id on public.tickets
  for each row execute function public.tickets_share_car_details();

-- ---------------------------------------------------------------------------
-- 5. a customer's details reach their open tickets

create or replace function public.customers_propagate_to_tickets() returns trigger
    language plpgsql security definer
    set search_path to ''
    as $$
declare
  addr_changed boolean := (new.address, new.city) is distinct from (old.address, old.city);
begin
  if (new.name, new.phone, new.email) is not distinct from (old.name, old.phone, old.email)
     and not addr_changed then
    return null;
  end if;

  update public.tickets t
     set customer_name = case when new.name  is distinct from old.name  then new.name  else t.customer_name end,
         phone         = case when new.phone is distinct from old.phone then new.phone else t.phone end,
         email         = case when new.email is distinct from old.email then new.email else t.email end,
         address       = case when addr_changed
                              then nullif(concat_ws(', ', nullif(btrim(new.address), ''), nullif(btrim(new.city), '')), '')
                              else t.address end
   where t.customer_id = new.id
     and public.ticket_is_open(t.id, t.status);
  return null;
end $$;

alter function public.customers_propagate_to_tickets() owner to postgres;

drop trigger if exists customers_propagate_to_tickets on public.customers;
create trigger customers_propagate_to_tickets
  after update of name, phone, email, address, city on public.customers
  for each row execute function public.customers_propagate_to_tickets();

-- ---------------------------------------------------------------------------
-- 6. a ticket moved to another customer: that customer is an owner of the car
--    now. Replaces the plate-matching version in 20261103110000 — a car is
--    known by its id now, not by how its plate was typed.
--
--    The old customer keeps the car unless this was their only work order for
--    it: then the ticket was opened on the wrong person, and the link was the
--    mistake.

create or replace function public.tickets_customer_moves_vehicle() returns trigger
    language plpgsql security definer
    set search_path to ''
    as $$
begin
  if new.customer_id is not distinct from old.customer_id
     or new.customer_id is null or new.car_id is null then
    return new;
  end if;

  insert into public.vehicles (customer_id, plate) values (new.customer_id, btrim(new.plate))
  on conflict (customer_id, plate) do nothing;

  if old.customer_id is not null and not exists (
    select 1 from public.tickets
     where customer_id = old.customer_id and car_id = new.car_id and id <> new.id
  ) then
    delete from public.vehicles where customer_id = old.customer_id and car_id = new.car_id;
  end if;
  return new;
end $$;
