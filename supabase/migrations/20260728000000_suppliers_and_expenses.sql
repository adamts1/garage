-- ============================================================
--  Phase 4c — supplier expense management (the "money out" side).
--
--  Invoicing (4a) records what the garage BILLS its customers. This records what
--  the garage SPENDS with its suppliers. The crucial difference in kind:
--
--    * An invoice is a legal document the garage ISSUES — only the provider may
--      allocate its number, and once issued it is immutable (4a).
--    * A supplier expense is a document the SUPPLIER issued; the garage only
--      RECORDS it for its own books. So these are the garage's own bookkeeping
--      entries — fully editable, no provider-owned number, no immutability.
--
--  Both are tenant-scoped exactly like every other table: garage_id defaults to
--  current_garage_id(), and the tenant_isolation policy confines each garage to
--  its own rows. anon is denied; service_role (the sync Edge Function) may write.
--
--  Sync: each row carries provider_* columns. The record-expense Edge Function
--  pushes the expense (and its supplier) into the accounting provider so it lands
--  in the accountant's books / input-VAT (מע״מ תשומות), then writes the provider
--  ids back here. sync_status tracks that round trip.
-- ============================================================

-- ---------- suppliers ----------
create table if not exists public.suppliers (
  id         uuid primary key default gen_random_uuid(),
  garage_id  uuid not null default public.current_garage_id()
             references public.garages(id) on delete restrict,
  name       text not null,
  tax_id     text,                       -- ח״פ / עוסק מורשה number
  phone      text,
  email      text,
  address    text,
  notes      text,
  -- The supplier's id in the accounting provider, filled on first sync so we
  -- don't create a duplicate supplier there on the next expense.
  provider_supplier_id text,
  created_at timestamptz not null default now()
);

create index if not exists suppliers_garage_id_idx on public.suppliers (garage_id);

alter table public.suppliers enable row level security;
grant select, insert, update, delete on public.suppliers to authenticated;
grant select, insert, update, delete on public.suppliers to service_role;
revoke all on public.suppliers from anon;

drop policy if exists tenant_isolation on public.suppliers;
create policy tenant_isolation on public.suppliers
  for all to authenticated
  using      (garage_id = (select public.current_garage_id()))
  with check (garage_id = (select public.current_garage_id()));

-- ---------- supplier expenses ----------
create table if not exists public.supplier_expenses (
  id           uuid primary key default gen_random_uuid(),
  garage_id    uuid not null default public.current_garage_id()
               references public.garages(id) on delete restrict,
  -- The supplier this expense is with. RESTRICT: don't let a supplier be deleted
  -- out from under its recorded expenses.
  supplier_id  uuid not null references public.suppliers(id) on delete restrict,

  expense_date date not null default current_date,
  description  text,
  category     text,                     -- free-text / provider expense type
  reference    text,                     -- the supplier's own document number

  -- Money. Stored, not derived — subtotal + vat as entered; vat_rate kept per
  -- row so an expense with a non-standard or zero VAT reads back correctly.
  subtotal     numeric(12,2) not null default 0,
  vat_rate     numeric(5,4)  not null default 0.18,
  vat          numeric(12,2) not null default 0,
  total        numeric(12,2) not null default 0,

  paid         boolean not null default false,

  -- Accounting-provider sync.
  provider           text not null default 'icount',
  provider_expense_id text,
  sync_status        text not null default 'pending'
                     check (sync_status in ('pending','synced','error')),
  sync_error         text,

  created_at   timestamptz not null default now()
);

create index if not exists supplier_expenses_garage_id_idx on public.supplier_expenses (garage_id);
create index if not exists supplier_expenses_supplier_id_idx on public.supplier_expenses (supplier_id);
create index if not exists supplier_expenses_date_idx on public.supplier_expenses (garage_id, expense_date desc);

alter table public.supplier_expenses enable row level security;
grant select, insert, update, delete on public.supplier_expenses to authenticated;
grant select, insert, update, delete on public.supplier_expenses to service_role;
revoke all on public.supplier_expenses from anon;

drop policy if exists tenant_isolation on public.supplier_expenses;
create policy tenant_isolation on public.supplier_expenses
  for all to authenticated
  using      (garage_id = (select public.current_garage_id()))
  with check (garage_id = (select public.current_garage_id()));
