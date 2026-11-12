-- A final price for the whole ticket (מחיר סופי לכרטיס).
--
-- What the customer pays for the visit, VAT included, set by an admin. The
-- works and parts keep their prices; when the final price is below what they
-- come to, the difference is a discount on the ticket as a whole. issue-invoice
-- spreads it over the lines in proportion, so the document still itemises the
-- work and adds up to exactly this figure. A final price above the lines is
-- not applied (issue-invoice refuses it; the screen offers to raise a labour).
-- See finalPriceNet / spreadToNet in packages/shared/src/catalog.ts.
--
-- Deploy order: this migration BEFORE the issue-invoice function, which
-- selects the column.

-- 1. the column ----------------------------------------------------------------

alter table public.tickets
  add column if not exists final_price numeric(12, 2);

alter table public.tickets
  drop constraint if exists tickets_final_price_positive;
alter table public.tickets
  add constraint tickets_final_price_positive check (final_price is null or final_price > 0);

comment on column public.tickets.final_price is
  'מחיר סופי לכרטיס: what the customer pays for the whole visit, VAT included, set by an admin. Below the lines, the difference is a ticket discount, spread over the lines on the invoice. Null = none.';

-- 2. who may set it, and when --------------------------------------------------
--
-- An admin only: it decides what the customer is charged, like the labour
-- price (save_ticket_works). And not under a live bill: the document was issued
-- at the price the ticket had then, the same rule that freezes the works
-- (works_follow_ticket_lock). A cancelled ticket is frozen whole already.
--
-- Only a CHANGE is checked, so a member saving a ticket carries the value they
-- read back untouched and is not refused for it.

create or replace function public.tickets_final_price_guard() returns trigger
    language plpgsql
    security definer
    set search_path to ''
    as $$
begin
  if tg_op = 'UPDATE' and new.final_price is not distinct from old.final_price then
    return new;
  end if;
  if tg_op = 'INSERT' and new.final_price is null then
    return new;
  end if;

  if not public.is_garage_admin() then
    raise exception 'only an admin can set the final price of a ticket'
      using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' and exists (
    select 1 from public.invoices
     where ticket_id = new.id
       and doc_type in ('invoice_receipt', 'tax_invoice')
       and status = 'issued'
  ) then
    raise exception 'the ticket has an issued invoice and its final price cannot be changed'
      using errcode = '42501';
  end if;

  return new;
end $$;

alter function public.tickets_final_price_guard() owner to postgres;

drop trigger if exists tickets_final_price_guard on public.tickets;
create trigger tickets_final_price_guard
  before insert or update of final_price on public.tickets
  for each row execute function public.tickets_final_price_guard();
