-- The vehicle on a ticket — plate, model, year, km, vehicle code — is now
-- editable from the board as well as from the phone, and the edit reaches the
-- customer's vehicle record, not only the ticket's copy.
--
-- 1. Frozen once billed. A ticket with a live bill (an invoice_receipt or
--    tax_invoice still 'issued') keeps the vehicle it was billed for: the
--    document was printed with that plate and that reading, and a ticket that
--    disagrees with its own invoice is the one record nobody can reconcile.
--    A bill credited in full is marked 'cancelled' by issue-invoice, and the
--    ticket is editable again — same rule cancelling uses. Status, payment and
--    every other column stay writable: close-and-charge and collect save the
--    ticket right after billing it.
--
-- 2. The vehicle record follows the ticket. create_ticket upserts the car into
--    `vehicles` on intake; nothing did afterwards, so a km typed in later or a
--    plate corrected from the bay never reached the customer's car list, and
--    the next intake prefilled the old values. `car` is one free-text field on
--    the ticket and two (manufacturer, model) on the vehicle, so it is not
--    split back — the model stays as the intake form recorded it.
--
--    A corrected plate renames the customer's vehicle row when no other ticket
--    of theirs still uses the old plate (a typo), and otherwise adds a new row
--    (the old plate is a real car of theirs too).

-- 1. ---------------------------------------------------------------------------

create or replace function public.tickets_vehicle_follows_invoice() returns trigger
    language plpgsql
    security definer
    set search_path to ''
    as $$
begin
  if (new.plate, new.car, new.year, new.km, new.vehicle_code)
       is not distinct from
     (old.plate, old.car, old.year, old.km, old.vehicle_code) then
    return new;
  end if;

  if exists (
    select 1 from public.invoices
     where ticket_id = new.id
       and doc_type in ('invoice_receipt', 'tax_invoice')
       and status = 'issued'
  ) then
    raise exception 'ticket % has an issued invoice — its vehicle cannot be changed', new.key
      using errcode = '42501';
  end if;
  return new;
end $$;

alter function public.tickets_vehicle_follows_invoice() owner to postgres;

comment on function public.tickets_vehicle_follows_invoice() is
  'Refuses changes to a ticket''s vehicle fields while it has a live bill. See 20261103090000_ticket_vehicle_edit.sql.';

drop trigger if exists tickets_vehicle_follows_invoice on public.tickets;
create trigger tickets_vehicle_follows_invoice
  before update of plate, car, year, km, vehicle_code on public.tickets
  for each row execute function public.tickets_vehicle_follows_invoice();

-- 2. ---------------------------------------------------------------------------

create or replace function public.tickets_sync_vehicle() returns trigger
    language plpgsql
    security definer
    set search_path to ''
    as $$
declare
  v_plate text := nullif(btrim(new.plate), '');
  v_old   text := nullif(btrim(old.plate), '');
begin
  if new.customer_id is null or v_plate is null or v_plate = '-' then
    return new;
  end if;
  if (new.plate, new.year, new.km, new.vehicle_code)
       is not distinct from
     (old.plate, old.year, old.km, old.vehicle_code) then
    return new;
  end if;

  -- A typo fixed: carry the existing row over to the new plate, so the
  -- customer is not left with a car that never existed.
  if v_old is not null and v_old <> '-' and v_old <> v_plate
     and not exists (
       select 1 from public.tickets
        where customer_id = new.customer_id
          and id <> new.id
          and btrim(plate) = v_old)
     and not exists (
       select 1 from public.vehicles
        where customer_id = new.customer_id and plate = v_plate)
  then
    update public.vehicles set plate = v_plate
     where customer_id = new.customer_id and plate = v_old;
  end if;

  -- Same merge as create_ticket: a supplied value wins, a blank keeps what
  -- was known.
  insert into public.vehicles (customer_id, garage_id, plate, year, km, vehicle_code)
  values (
    new.customer_id, new.garage_id, v_plate,
    nullif(new.year, ''), nullif(new.km, ''), nullif(new.vehicle_code, '')
  )
  on conflict (customer_id, plate) do update set
    year         = coalesce(excluded.year,         public.vehicles.year),
    km           = coalesce(excluded.km,           public.vehicles.km),
    vehicle_code = coalesce(excluded.vehicle_code, public.vehicles.vehicle_code);
  return new;
end $$;

alter function public.tickets_sync_vehicle() owner to postgres;

comment on function public.tickets_sync_vehicle() is
  'Carries an edit of a ticket''s plate/year/km/vehicle code into the customer''s vehicles row. See 20261103090000_ticket_vehicle_edit.sql.';

drop trigger if exists tickets_sync_vehicle on public.tickets;
create trigger tickets_sync_vehicle
  after update of plate, year, km, vehicle_code on public.tickets
  for each row execute function public.tickets_sync_vehicle();
