-- Every expense can carry the document it was recorded from (2026-11-16).
--
-- Scanning reached the web, and with it two things the phone did not need:
--
--   1. PDFs. Suppliers email their invoices; the model reads a PDF as it is,
--      so it is stored as it is. The bucket takes application/pdf and a larger
--      file than a shrunk photo.
--   2. A document on an expense that was typed, not read. Attached on the form
--      while entering it, or afterwards from the list. It is the same thing as
--      a scan's pages — an expense_scans row and its files — only nobody asked
--      the model about it, so the row has no `result` and the expense keeps
--      source = 'manual'.
--
-- The web form also has fields the phone did not send (category, description,
-- due date, cheque date), so save_scanned_expense takes them — as defaults, so
-- the phone's calls are unchanged.

-- ------------------------------------------------------------ the bucket

update storage.buckets
   set allowed_mime_types = array['image/jpeg', 'application/pdf'],
       file_size_limit = 10485760
 where id = 'expense-scans';

-- ------------------------------------------------------------ page names

/* A scan's page list: 1–5 bare object names inside the scan's folder, no
   repeats. The same rule extract-invoice applies (PAGE_NAME there). No slash
   and no dot-dot can pass, so a name cannot leave the folder. */
create or replace function public.valid_scan_pages(p text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p is not null
     and cardinality(p) between 1 and 5
     and (select bool_and(n ~ '^[A-Za-z0-9_-]{4,64}\.(jpg|pdf)$') from unnest(p) n)
     and (select count(distinct n) from unnest(p) n) = cardinality(p);
$$;

alter function public.valid_scan_pages(text[]) owner to postgres;
revoke all on function public.valid_scan_pages(text[]) from public, anon;
grant execute on function public.valid_scan_pages(text[]) to authenticated, service_role;

-- ------------------------------------------------------------ saving

drop function if exists public.save_scanned_expense(uuid, uuid, text, text, date, text, jsonb, numeric, boolean, date, text, date, boolean);

/* As in 20261115120000, plus:
     p_category, p_description — the web form's fields.
     p_pages — the document's files, when nobody read them (attached on the
       form). A scan that was read already has its pages, set by extract-invoice.
   The expense is source 'scan' when the model read the document, 'manual'
   when a person typed it and attached the document. */
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
  p_allow_duplicate boolean default false,
  p_category text default null,
  p_description text default null,
  p_pages text[] default null
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

  if p_pages is not null then
    if not public.valid_scan_pages(p_pages) then
      raise exception 'pages must be 1–5 file names' using errcode = '22023';
    end if;
  elsif v_scan.pages is null and v_scan.result is null then
    raise exception 'the document has no pages' using errcode = '22023';
  end if;

  if p_date is null then
    raise exception 'an expense needs a date' using errcode = '22023';
  end if;
  if p_vat_rate is null or p_vat_rate < 0 or p_vat_rate >= 1 then
    raise exception 'VAT rate out of range' using errcode = '22023';
  end if;

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
    category, description,
    source, scan_id
  ) values (
    v_garage, v_supplier, p_date, v_reference, v_lines,
    v_subtotal, p_vat_rate, v_vat, v_subtotal + v_vat,
    coalesce(p_paid, false), p_due_date, nullif(btrim(p_cheque_number), ''), p_cheque_date,
    nullif(btrim(p_category), ''), nullif(btrim(p_description), ''),
    case when v_scan.result is not null then 'scan' else 'manual' end, p_scan_id
  )
  returning id into v_expense;

  update public.expense_scans
     set status = 'saved', expense_id = v_expense, saved_at = now(),
         pages = coalesce(p_pages, pages),
         page_count = coalesce(cardinality(p_pages), page_count)
   where id = p_scan_id;

  return v_expense;
end;
$$;

alter function public.save_scanned_expense(uuid, uuid, text, text, date, text, jsonb, numeric, boolean, date, text, date, boolean, text, text, text[]) owner to postgres;
revoke all on function public.save_scanned_expense(uuid, uuid, text, text, date, text, jsonb, numeric, boolean, date, text, date, boolean, text, text, text[]) from public, anon;
grant execute on function public.save_scanned_expense(uuid, uuid, text, text, date, text, jsonb, numeric, boolean, date, text, date, boolean, text, text, text[]) to authenticated;

-- ------------------------------------------------------------ attaching later

/* A document for an expense that was saved without one. Only when it has
   none: a document, once on an expense, is not swapped for another — it is
   the record of what the expense was entered from. */
create or replace function public.attach_expense_document(
  p_expense_id uuid,
  p_scan_id uuid,
  p_pages text[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_garage uuid := public.current_garage_id();
  v_scan public.expense_scans%rowtype;
begin
  if v_garage is null then
    raise exception 'no garage for this user' using errcode = '42501';
  end if;
  if not public.valid_scan_pages(p_pages) then
    raise exception 'pages must be 1–5 file names' using errcode = '22023';
  end if;

  select * into v_scan
    from public.expense_scans
   where id = p_scan_id and garage_id = v_garage
   for update;
  if not found then
    raise exception 'document not found in your garage' using errcode = 'P0002';
  end if;
  if v_scan.status = 'saved' then
    raise exception 'that document already belongs to an expense' using errcode = '22023';
  end if;

  update public.supplier_expenses
     set scan_id = p_scan_id
   where id = p_expense_id and garage_id = v_garage and scan_id is null;
  if not found then
    if exists (select 1 from public.supplier_expenses where id = p_expense_id and garage_id = v_garage) then
      raise exception 'this expense already has a document' using errcode = '22023';
    end if;
    raise exception 'expense not found in your garage' using errcode = 'P0002';
  end if;

  update public.expense_scans
     set status = 'saved', expense_id = p_expense_id, saved_at = now(),
         pages = p_pages, page_count = cardinality(p_pages)
   where id = p_scan_id;
end;
$$;

alter function public.attach_expense_document(uuid, uuid, text[]) owner to postgres;
revoke all on function public.attach_expense_document(uuid, uuid, text[]) from public, anon;
grant execute on function public.attach_expense_document(uuid, uuid, text[]) to authenticated;
