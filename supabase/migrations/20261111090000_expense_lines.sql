-- An expense as the supplier's invoice has it: several items, each with a
-- quantity (2026-11-11). Until now an expense was one pre-VAT figure.
--
-- The lines are the breakdown; `subtotal` stays the figure every report and
-- the iCount sync read, and the client writes it as the sum of the lines.
-- Expenses from before this have no lines ('[]') and are shown by their
-- subtotal alone, as they always were.
--
-- Each line: { "desc": text, "qty": number, "unit_price": number } — pre-VAT,
-- like every price in this system.

alter table public.supplier_expenses
  add column if not exists lines jsonb not null default '[]'::jsonb;

alter table public.supplier_expenses
  drop constraint if exists supplier_expenses_lines_is_array;
alter table public.supplier_expenses
  add constraint supplier_expenses_lines_is_array check (jsonb_typeof(lines) = 'array');

comment on column public.supplier_expenses.lines is
  'Items on the supplier invoice: [{desc, qty, unit_price}], pre-VAT. subtotal is their sum; [] on expenses entered as a single figure.';
