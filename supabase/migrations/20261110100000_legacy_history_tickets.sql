-- Work orders brought over from the garage's previous system, kept as history.
--
-- A garage moving to us brings years of work cards (2026-11-10: the Metal /
-- Ricbi program). They belong in each car's history, and nowhere else:
--
--   * they are not ours to number. Their key is the old system's, behind its
--     own prefix (RB-1131), and garage_counters never moves for them, so the
--     garage's own GAR- sequence starts where it would have anyway;
--   * they are a record, not work: no one edits, invoices or re-opens them;
--   * they are not on the board, in the archive or in any report. The apps
--     load them only for a car's history (listTickets leaves them out), so a
--     screen added later does not have to remember to filter them.
--
-- The import itself writes with the service role, which the number lock
-- already lets write its own keys (20261101100000). This migration only adds
-- the mark and holds the rows still.

-- 1. the mark -----------------------------------------------------------------

alter table public.tickets
  add column if not exists legacy_source text,
  add column if not exists legacy_number text;

alter table public.tickets drop constraint if exists tickets_legacy_complete;
alter table public.tickets add constraint tickets_legacy_complete
  check ((legacy_source is null) = (legacy_number is null));

alter table public.tickets drop constraint if exists tickets_legacy_source_check;
alter table public.tickets add constraint tickets_legacy_source_check
  check (legacy_source in ('ricbi'));

-- One row per old card, so a re-run of an import finds what it already wrote.
create unique index if not exists tickets_garage_legacy_key
  on public.tickets (garage_id, legacy_source, legacy_number)
  where legacy_source is not null;

comment on column public.tickets.legacy_source is
  'Set on a work order imported from the garage''s previous system, as history: a code naming that system (ricbi). NULL on every ticket made here. An imported ticket is read-only, takes no number from garage_counters, cannot be invoiced, and is left out of listTickets — the apps show it only in a car''s history. See 20261110100000_legacy_history_tickets.sql.';
comment on column public.tickets.legacy_number is
  'The work order''s number in the previous system, as that system printed it. Set together with legacy_source.';

-- 2. held still ---------------------------------------------------------------
--    Users neither create imported tickets nor change them. The service role
--    (the import, a support fix) is not held to it.

create or replace function public.tickets_guard_legacy() returns trigger
    language plpgsql
    set search_path to ''
    as $$
begin
  if coalesce(auth.role(), '') not in ('authenticated', 'anon') then
    return coalesce(new, old);
  end if;
  if tg_op = 'INSERT' then
    if new.legacy_source is not null then
      raise exception 'imported history is written by the import only' using errcode = '42501';
    end if;
  elsif old.legacy_source is not null or new.legacy_source is not null then
    raise exception 'ticket % is imported history and cannot be changed', old.key
      using errcode = '42501';
  end if;
  return new;
end $$;

alter function public.tickets_guard_legacy() owner to postgres;

drop trigger if exists tickets_guard_legacy on public.tickets;
create trigger tickets_guard_legacy
  before insert or update on public.tickets
  for each row execute function public.tickets_guard_legacy();

-- Works and parts are part of the record, as they are for a cancelled ticket.
create or replace function public.works_guard_legacy() returns trigger
    language plpgsql
    security definer
    set search_path to ''
    as $$
declare
  tid uuid;
begin
  if coalesce(auth.role(), '') not in ('authenticated', 'anon') then
    return coalesce(new, old);
  end if;
  if tg_table_name = 'works' then
    tid := coalesce(new.ticket_id, old.ticket_id);
  else
    select w.ticket_id into tid from public.works w
     where w.id = coalesce(new.work_id, old.work_id);
  end if;
  if exists (select 1 from public.tickets where id = tid and legacy_source is not null) then
    raise exception 'the ticket is imported history and its works cannot be changed'
      using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;

alter function public.works_guard_legacy() owner to postgres;

drop trigger if exists works_guard_legacy on public.works;
create trigger works_guard_legacy
  before insert or update or delete on public.works
  for each row execute function public.works_guard_legacy();

drop trigger if exists work_items_guard_legacy on public.work_items;
create trigger work_items_guard_legacy
  before insert or update or delete on public.work_items
  for each row execute function public.works_guard_legacy();

-- Never billed here: the old system billed it already. issue-invoice writes
-- with the service role, so this is held for every role.
create or replace function public.invoices_refuse_legacy() returns trigger
    language plpgsql
    security definer
    set search_path to ''
    as $$
begin
  if new.ticket_id is not null and exists (
    select 1 from public.tickets where id = new.ticket_id and legacy_source is not null
  ) then
    raise exception 'imported history cannot be invoiced' using errcode = '42501';
  end if;
  return new;
end $$;

alter function public.invoices_refuse_legacy() owner to postgres;

drop trigger if exists invoices_refuse_legacy on public.invoices;
create trigger invoices_refuse_legacy
  before insert on public.invoices
  for each row execute function public.invoices_refuse_legacy();

-- 3. not open -----------------------------------------------------------------
--    The triggers that carry a customer's or a car's details onto its open
--    tickets ask ticket_is_open. An imported ticket is a record of that visit
--    as it was: it is never open, so a customer edit neither rewrites it nor
--    trips the guard above. Recreated from 20261104090000 with that one test.

create or replace function public.ticket_is_open(p_ticket_id uuid, p_status text) returns boolean
    language sql stable security definer
    set search_path to ''
    as $$
  select p_status <> 'cancelled'
     and not exists (
       select 1 from public.tickets
        where id = p_ticket_id and legacy_source is not null)
     and not exists (
       select 1 from public.invoices
        where ticket_id = p_ticket_id
          and doc_type in ('invoice_receipt', 'tax_invoice')
          and status = 'issued')
$$;

alter function public.ticket_is_open(uuid, text) owner to postgres;
