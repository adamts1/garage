-- Pre-launch hardening: least privilege, pinned search paths, and one bill per
-- ticket. Three findings from the review before the first garage goes live.
--
-- Nothing here changes what the apps can do. Every statement removes a
-- privilege nobody uses, pins a setting that was already effectively in force,
-- or writes down a rule the code already tries to keep.


-- ============================================================
-- 1. TRUNCATE, REFERENCES and TRIGGER, which nobody needs
-- ============================================================
--
-- These are inherited from the platform's default ACL rather than granted by
-- any migration, and RLS does not gate TRUNCATE: a policy that scopes a garage
-- to its own rows is no obstacle at all to `truncate public.tickets`, which
-- takes every garage's with it.
--
-- The baseline already knew this — it revokes them at its foot — but it does so
-- from a hand-written list of thirteen tables and from `anon` only. Five tables
-- created since were never added (garage_billing, garage_billing_secrets,
-- garage_counters, garage_workers, invoices), and `authenticated` was never
-- covered at all, which is the wider hole: every mechanic at every garage holds
-- that role.
--
-- Not currently reachable. PostgREST has no TRUNCATE verb, and neither role can
-- open a direct connection — so this is depth, not a patched breach. It is
-- cheap depth, and the one grant whose blast radius is every tenant at once.
--
-- A loop rather than a list, because the list is what went wrong: a table added
-- next month is covered by this without anybody remembering to come back.
do $$
declare
  t record;
begin
  for t in
    select schemaname, tablename from pg_tables where schemaname = 'public'
  loop
    execute format(
      'revoke truncate, references, trigger on public.%I from anon, authenticated',
      t.tablename
    );
  end loop;
end $$;

-- And for tables that do not exist yet. Default privileges attach to the role
-- that creates the object; migrations run as postgres, so this covers every
-- table a future migration adds — the same gap, closed ahead of time instead of
-- after the next audit.
alter default privileges for role postgres in schema public
  revoke truncate, references, trigger on tables from anon, authenticated;


-- ============================================================
-- 2. The two functions with a mutable search_path
-- ============================================================
--
-- Every other function in the schema pins `search_path = ''` and schema-
-- qualifies what it touches; these two predate the convention. Both are
-- SECURITY INVOKER triggers, so there is no privilege to escalate into, and
-- both reference nothing but built-ins — which is why pinning them needs no
-- other change. Recreated verbatim with the setting added.

create or replace function public.invoices_are_immutable() returns trigger
    language plpgsql
    set search_path to ''
    as $$
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

create or replace function public.touch_updated_at() returns trigger
    language plpgsql
    set search_path to ''
    as $$
begin
  new.updated_at := now();
  return new;
end $$;


-- ============================================================
-- 3. One live bill per ticket
-- ============================================================
--
-- issue-invoice already refuses to bill a ticket twice: it looks for an issued
-- invoice_receipt or tax_invoice on the ticket and returns that one instead.
-- But the look and the insert are two round trips with a provider call between
-- them, so two calls that overlap — a double-click that outruns the disabled
-- button, a retried request, two advisors on two counters — both look, both
-- find nothing, and both bill the customer.
--
-- That is the one duplicate in this system that cannot be tidied up afterwards:
-- a second tax document exists at the provider and at the tax authority, and
-- the only way back is a credit note.
--
-- The index does not stop the second document being issued at the provider —
-- nothing on this side of the network can — but it stops the second row, so the
-- duplicate surfaces as a loud failure on a request nobody was waiting on
-- rather than as a second invoice in the customer's file. The function's own
-- check still handles the ordinary case, which is a user pressing the button
-- again a second later.
--
-- Scoped to `status = 'issued'` deliberately: a bill that has been cancelled by
-- a full credit note is no longer live, and a ticket whose invoice was
-- cancelled must be billable again.
create unique index if not exists invoices_one_live_bill_per_ticket
  on public.invoices (ticket_id)
  where ticket_id is not null
    and status = 'issued'
    and doc_type in ('invoice_receipt', 'tax_invoice');

comment on index public.invoices_one_live_bill_per_ticket is
  'A ticket carries at most one live bill. The last line of defence behind issue-invoice''s own idempotency check, for two calls that overlap.';
