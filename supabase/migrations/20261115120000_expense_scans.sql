-- Scanned supplier invoices (2026-11-15).
--
-- A garage photographs a paper supplier invoice (1–5 pages) in the mobile app,
-- a model reads the items off it, a person checks them, and it is saved as ONE
-- supplier expense — the same row a typed expense is, with the items in
-- `lines`. One invoice, one expense: the bookkeeping export, the reports and
-- the expenses screen all count an expense as an invoice, and splitting one
-- into a row per item would reach the bookkeeper as a dozen small bills.
--
-- THE FLOW, AND WHO WRITES WHAT
--
--   1. The app inserts an expense_scans row (page_count only) → gets its id.
--   2. It uploads the pages to expense-scans/{garage_id}/{scan_id}/page-{n}.jpg.
--   3. The extract-invoice Edge Function reads them, asks the model, and writes
--      the result back onto the row (service_role — the client cannot).
--   4. The person reviews and calls save_scanned_expense(), which creates the
--      supplier if it is new and the expense, and marks the scan saved — in one
--      transaction.
--
-- The page paths are not stored: they are derived from garage, scan id and page
-- number. So the function is handed a scan id and nothing else, and there is no
-- path a caller can name that would make it read another garage's images.
--
-- A scan that was extracted and never saved is the draft: leaving the review
-- screen and coming back reads the result off this row again.
--
-- `result` and the token counts are kept for measurement. The difference between
-- what the model read (`result`) and what was saved (the expense) is the error
-- rate, per field, on real invoices — the data that decides which model to keep.

create table if not exists public.expense_scans (
  id uuid primary key default gen_random_uuid(),
  garage_id uuid not null default public.current_garage_id()
    references public.garages(id) on delete restrict,

  status text not null default 'uploaded',
  page_count smallint not null,

  /* What the model returned, as it returned it — never edited afterwards. */
  result jsonb,
  model text,
  /* The model's or our own words when extraction failed. */
  error text,
  duration_ms integer,
  input_tokens integer,
  output_tokens integer,

  /* Set once saved. One scan is one expense: see the unique index on
     supplier_expenses.scan_id below. */
  expense_id uuid,

  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  extracted_at timestamptz,
  saved_at timestamptz,

  constraint expense_scans_status_check
    check (status in ('uploaded', 'extracted', 'failed', 'saved')),
  constraint expense_scans_page_count_check check (page_count between 1 and 5)
);

comment on table public.expense_scans is
  'A photographed supplier invoice on its way to becoming a supplier expense. Pages live in the expense-scans bucket at {garage_id}/{id}/page-{n}.jpg (n from 1). An extracted, unsaved scan is the draft of the review screen.';
comment on column public.expense_scans.result is
  'The model''s extraction exactly as returned. Compared against the saved expense, it is how extraction accuracy is measured; never edited.';

create index if not exists expense_scans_recent_idx
  on public.expense_scans using btree (garage_id, created_at desc);

alter table public.expense_scans enable row level security;

create policy "tenant_isolation_read" on public.expense_scans
  for select to authenticated
  using (garage_id = (select public.current_garage_id()));

/* A client may start a scan in its own garage and do nothing else. The column
   grant below is what limits it to page_count: status, result and the rest
   take their defaults and are written only by the function and the RPC. */
create policy "tenant_isolation_insert" on public.expense_scans
  for insert to authenticated
  with check (garage_id = (select public.current_garage_id()));

grant select on table public.expense_scans to authenticated;
grant insert (page_count) on table public.expense_scans to authenticated;
grant all on table public.expense_scans to service_role;
revoke all on table public.expense_scans from anon;

-- ------------------------------------------------------------ on the expense

alter table public.supplier_expenses
  add column if not exists source text not null default 'manual',
  add column if not exists scan_id uuid references public.expense_scans(id) on delete set null;

alter table public.supplier_expenses
  drop constraint if exists supplier_expenses_source_check;
alter table public.supplier_expenses
  add constraint supplier_expenses_source_check check (source in ('manual', 'scan'));

comment on column public.supplier_expenses.source is
  'How the expense was entered: typed (manual) or read off a photographed invoice (scan).';
comment on column public.supplier_expenses.scan_id is
  'The scan it was read from, when source = scan. Its pages are the image of the original invoice.';

/* One scan, one expense — so a double tap on save, or a retry after a dropped
   connection, cannot record the same invoice twice. */
create unique index if not exists supplier_expenses_scan_id_key
  on public.supplier_expenses using btree (scan_id) where scan_id is not null;

/* The duplicate check: same supplier, same invoice number. */
create index if not exists supplier_expenses_reference_idx
  on public.supplier_expenses using btree (garage_id, supplier_id, lower(btrim(reference)))
  where reference is not null;

alter table public.expense_scans
  drop constraint if exists expense_scans_expense_id_fkey;
alter table public.expense_scans
  add constraint expense_scans_expense_id_fkey
  foreign key (expense_id) references public.supplier_expenses(id) on delete set null;

-- ------------------------------------------------------------ the images

/* Private, small and JPEG only. The app shrinks each page to 1568 px on the
   long side before upload (the model scales anything larger down anyway), which
   is a few hundred KB; 3 MB is room for that, not for an unshrunk photo. */
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('expense-scans', 'expense-scans', false, 3145728, array['image/jpeg'])
on conflict (id) do nothing;

/* Upload and read in the garage's own folder. No update or delete: the pages
   are the image of the original invoice, and nothing in the app replaces one
   after it is uploaded (a retake happens on the phone, before upload). */
create policy "expense_scans_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'expense-scans'
    and name like ((select public.current_garage_id())::text || '/%')
  );

create policy "expense_scans_read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'expense-scans'
    and name like ((select public.current_garage_id())::text || '/%')
  );

-- ------------------------------------------------------------ saving

/* Digits only — how a tax id is compared. Typed and printed forms differ in
   dashes and spaces ("51-234567-8"), and that must not make a second supplier. */
create or replace function public.tax_id_digits(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g'), '');
$$;

alter function public.tax_id_digits(text) owner to postgres;
revoke all on function public.tax_id_digits(text) from public, anon;
grant execute on function public.tax_id_digits(text) to authenticated, service_role;

/* Save a reviewed scan as one supplier expense, in one transaction: create the
   supplier when it is new, refuse a duplicate unless the person confirmed it,
   insert the expense, mark the scan saved.

   The lines arrive pre-VAT, as everywhere in this system — converting a
   VAT-inclusive invoice is the review screen's job, done before this is called.
   Subtotal, VAT and total are derived here from the lines and the rate, the same
   way createExpense() derives them, so a stored expense is always consistent
   whichever screen wrote it.

   Idempotent: calling it again for a scan already saved returns that expense.

   A duplicate is refused with SQLSTATE 23505 and the existing expense's id in
   the hint, so the app can say which expense it clashes with and offer to save
   anyway (p_allow_duplicate). */
create or replace function public.save_scanned_expense(
  p_scan_id uuid,
  p_supplier_id uuid,
  p_supplier_name text,
  p_supplier_tax_id text,
  p_date date,
  p_reference text,
  p_lines jsonb,
  p_vat_rate numeric,
  p_paid boolean default false,
  p_due_date date default null,
  p_cheque_number text default null,
  p_cheque_date date default null,
  p_allow_duplicate boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_garage uuid := public.current_garage_id();
  v_scan public.expense_scans%rowtype;
  v_supplier uuid := p_supplier_id;
  v_name text := nullif(btrim(p_supplier_name), '');
  v_tax text := public.tax_id_digits(p_supplier_tax_id);
  v_reference text := nullif(btrim(p_reference), '');
  v_lines jsonb := '[]'::jsonb;
  v_line jsonb;
  v_desc text;
  v_qty numeric;
  v_price numeric;
  v_subtotal numeric := 0;
  v_vat numeric;
  v_existing uuid;
  v_expense uuid;
begin
  if v_garage is null then
    raise exception 'no garage for this user' using errcode = '42501';
  end if;

  select * into v_scan
    from public.expense_scans
   where id = p_scan_id and garage_id = v_garage
   for update;
  if not found then
    raise exception 'scan not found in your garage' using errcode = 'P0002';
  end if;
  if v_scan.status = 'saved' and v_scan.expense_id is not null then
    return v_scan.expense_id;
  end if;

  if p_date is null then
    raise exception 'an expense needs a date' using errcode = '22023';
  end if;
  if p_vat_rate is null or p_vat_rate < 0 or p_vat_rate >= 1 then
    raise exception 'VAT rate out of range' using errcode = '22023';
  end if;

  -- The lines, checked and put in the one shape the column holds.
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'an expense needs at least one item' using errcode = '22023';
  end if;
  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_desc := nullif(btrim(v_line->>'desc'), '');
    begin
      v_qty := (v_line->>'qty')::numeric;
      v_price := (v_line->>'unit_price')::numeric;
    exception when others then
      raise exception 'an item has a quantity or price that is not a number' using errcode = '22023';
    end;
    if v_desc is null or v_qty is null or v_qty <= 0 or v_price is null or v_price < 0 then
      raise exception 'every item needs a description, a quantity above 0 and a price' using errcode = '22023';
    end if;
    v_lines := v_lines || jsonb_build_object('desc', v_desc, 'qty', v_qty, 'unit_price', v_price);
    v_subtotal := v_subtotal + v_qty * v_price;
  end loop;
  v_subtotal := round(v_subtotal, 2);
  v_vat := round(v_subtotal * p_vat_rate, 2);

  -- The supplier: the one picked, else the garage's supplier with this tax id,
  -- else a new one.
  if v_supplier is not null then
    if not exists (select 1 from public.suppliers where id = v_supplier and garage_id = v_garage) then
      raise exception 'supplier not found in your garage' using errcode = 'P0002';
    end if;
  else
    if v_tax is not null then
      select id into v_supplier
        from public.suppliers
       where garage_id = v_garage and public.tax_id_digits(tax_id) = v_tax
       order by created_at
       limit 1;
    end if;
    if v_supplier is null then
      if v_name is null then
        raise exception 'a new supplier needs a name' using errcode = '22023';
      end if;
      insert into public.suppliers (garage_id, name, tax_id)
      values (v_garage, v_name, v_tax)
      returning id into v_supplier;
    end if;
  end if;

  if v_reference is not null and not p_allow_duplicate then
    select id into v_existing
      from public.supplier_expenses
     where garage_id = v_garage
       and supplier_id = v_supplier
       and lower(btrim(reference)) = lower(v_reference)
     limit 1;
    if v_existing is not null then
      raise exception 'duplicate invoice' using errcode = '23505', hint = v_existing::text;
    end if;
  end if;

  insert into public.supplier_expenses (
    garage_id, supplier_id, expense_date, reference, lines,
    subtotal, vat_rate, vat, total,
    paid, due_date, cheque_number, cheque_date,
    source, scan_id
  ) values (
    v_garage, v_supplier, p_date, v_reference, v_lines,
    v_subtotal, p_vat_rate, v_vat, v_subtotal + v_vat,
    coalesce(p_paid, false), p_due_date, nullif(btrim(p_cheque_number), ''), p_cheque_date,
    'scan', p_scan_id
  )
  returning id into v_expense;

  update public.expense_scans
     set status = 'saved', expense_id = v_expense, saved_at = now()
   where id = p_scan_id;

  return v_expense;
end;
$$;

alter function public.save_scanned_expense(uuid, uuid, text, text, date, text, jsonb, numeric, boolean, date, text, date, boolean) owner to postgres;
revoke all on function public.save_scanned_expense(uuid, uuid, text, text, date, text, jsonb, numeric, boolean, date, text, date, boolean) from public, anon;
grant execute on function public.save_scanned_expense(uuid, uuid, text, text, date, text, jsonb, numeric, boolean, date, text, date, boolean) to authenticated;
