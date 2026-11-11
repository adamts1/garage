-- Undo 20261110100000_legacy_history_tickets.sql.
--
-- Run by hand, only after the app has been rolled back to a version from
-- before PR #142 — that app neither reads nor writes the two columns.
--
-- It refuses while any imported card is still in the database: dropping the
-- columns would turn every RB- card into an ordinary, editable, billable work
-- order of the garage's. Those rows are not deleted here (tickets are never
-- deleted); deal with them first, on purpose.
--
--   psql "$DB_URL" -f supabase/rollbacks/20261110100000_legacy_history_tickets.down.sql

begin;

do $$
declare n integer;
begin
  select count(*) into n from public.tickets where legacy_source is not null;
  if n > 0 then
    raise exception '% imported ticket(s) still carry legacy_source — refusing to drop the column', n;
  end if;
end $$;

-- ticket_is_open as it was before (20261104090000).
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

drop trigger if exists invoices_refuse_legacy on public.invoices;
drop function if exists public.invoices_refuse_legacy();
drop trigger if exists work_items_guard_legacy on public.work_items;
drop trigger if exists works_guard_legacy on public.works;
drop function if exists public.works_guard_legacy();
drop trigger if exists tickets_guard_legacy on public.tickets;
drop function if exists public.tickets_guard_legacy();

drop index if exists public.tickets_garage_legacy_key;
alter table public.tickets drop constraint if exists tickets_legacy_source_check;
alter table public.tickets drop constraint if exists tickets_legacy_complete;
alter table public.tickets drop column if exists legacy_number;
alter table public.tickets drop column if exists legacy_source;

delete from supabase_migrations.schema_migrations where version = '20261110100000';

commit;
