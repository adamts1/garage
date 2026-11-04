-- The customer on a ticket is now editable from the board while the ticket is
-- open: its details corrected, or the ticket moved to a different customer.
--
-- 1. Frozen once billed, the same rule as the vehicle (20261103090000). The
--    invoice was printed with this name and this number; a ticket that
--    disagrees with its own document is the one record nobody can reconcile.
--    A bill credited in full is 'cancelled' and the ticket opens again. A
--    cancelled ticket is frozen whole by tickets_guard_lifecycle already.
--
--    Moving a ticket to another customer must stay inside the garage, and a
--    ticket that belongs to a customer cannot be made to belong to nobody.
--    `tickets_customer_id_fkey` checks only that the row exists, not whose it
--    is.
--
-- 2. The car follows the ticket to its new customer. The vehicles row is the
--    customer's; when the ticket moves, the car it was opened for has to be in
--    the new customer's list, or the next intake for them cannot prefill it.
--    When no other ticket of the old customer uses that plate the ticket was
--    simply opened on the wrong person, so the row is moved; otherwise it is a
--    real car of theirs too and the new customer gets a copy.
--
-- Correcting a customer's details (name, phone, email, address) on the ticket
-- also updates the customer record; the board does that write itself, beside
-- the ת״ז it already saved there. Other tickets keep the details they were
-- opened with — they record what was true at the time.

-- 1. ---------------------------------------------------------------------------

create or replace function public.tickets_customer_follows_invoice() returns trigger
    language plpgsql
    security definer
    set search_path to ''
    as $$
begin
  if (new.customer_id, new.customer_name, new.phone, new.email, new.address)
       is not distinct from
     (old.customer_id, old.customer_name, old.phone, old.email, old.address) then
    return new;
  end if;

  if exists (
    select 1 from public.invoices
     where ticket_id = new.id
       and doc_type in ('invoice_receipt', 'tax_invoice')
       and status = 'issued'
  ) then
    raise exception 'ticket % has an issued invoice — its customer cannot be changed', new.key
      using errcode = '42501';
  end if;

  if new.customer_id is distinct from old.customer_id then
    if new.customer_id is null then
      raise exception 'ticket % cannot be detached from its customer', new.key
        using errcode = '23502';
    end if;
    if not exists (
      select 1 from public.customers
       where id = new.customer_id and garage_id = new.garage_id
    ) then
      raise exception 'customer not found or not in this garage' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

alter function public.tickets_customer_follows_invoice() owner to postgres;

comment on function public.tickets_customer_follows_invoice() is
  'Refuses changes to a ticket''s customer while it has a live bill, and a move to a customer outside the garage. See 20261103110000_ticket_customer_edit.sql.';

drop trigger if exists tickets_customer_follows_invoice on public.tickets;
create trigger tickets_customer_follows_invoice
  before update of customer_id, customer_name, phone, email, address on public.tickets
  for each row execute function public.tickets_customer_follows_invoice();

-- 2. ---------------------------------------------------------------------------

create or replace function public.tickets_customer_moves_vehicle() returns trigger
    language plpgsql
    security definer
    set search_path to ''
    as $$
declare
  v_plate text := nullif(btrim(new.plate), '');
  src     public.vehicles;
begin
  if new.customer_id is not distinct from old.customer_id
     or new.customer_id is null or old.customer_id is null
     or v_plate is null or v_plate = '-' then
    return new;
  end if;

  select * into src from public.vehicles
   where customer_id = old.customer_id and plate = v_plate;

  -- Opened on the wrong person: the car was never theirs, so it goes.
  if src.id is not null
     and not exists (
       select 1 from public.tickets
        where customer_id = old.customer_id
          and id <> new.id
          and btrim(plate) = v_plate)
     and not exists (
       select 1 from public.vehicles
        where customer_id = new.customer_id and plate = v_plate)
  then
    update public.vehicles set customer_id = new.customer_id where id = src.id;
    return new;
  end if;

  -- Otherwise the new customer gets the car too. Same merge as create_ticket:
  -- what they already have on file wins over a blank.
  insert into public.vehicles (customer_id, garage_id, plate, manufacturer, model, year, km, vehicle_code)
  values (
    new.customer_id, new.garage_id, v_plate,
    src.manufacturer, src.model,
    coalesce(nullif(new.year, ''), src.year),
    coalesce(nullif(new.km, ''), src.km),
    coalesce(nullif(new.vehicle_code, ''), src.vehicle_code)
  )
  on conflict (customer_id, plate) do update set
    manufacturer = coalesce(public.vehicles.manufacturer, excluded.manufacturer),
    model        = coalesce(public.vehicles.model,        excluded.model),
    year         = coalesce(excluded.year,         public.vehicles.year),
    km           = coalesce(excluded.km,           public.vehicles.km),
    vehicle_code = coalesce(excluded.vehicle_code, public.vehicles.vehicle_code);
  return new;
end $$;

alter function public.tickets_customer_moves_vehicle() owner to postgres;

comment on function public.tickets_customer_moves_vehicle() is
  'Carries the ticket''s car to its new customer when the ticket is moved. See 20261103110000_ticket_customer_edit.sql.';

drop trigger if exists tickets_customer_moves_vehicle on public.tickets;
create trigger tickets_customer_moves_vehicle
  after update of customer_id on public.tickets
  for each row execute function public.tickets_customer_moves_vehicle();
