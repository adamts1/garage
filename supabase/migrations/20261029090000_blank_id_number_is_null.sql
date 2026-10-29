-- A blank ת״ז is no ת״ז.
--
-- customers_garage_id_number_key is unique on (garage_id, id_number) where
-- id_number IS NOT NULL. The customers screen sent its draft as typed, so a
-- customer saved without a ת״ז was stored with '' rather than NULL. '' is not
-- NULL, so the first such customer in a garage claimed the empty string, and
-- every later customer saved without one was refused as a duplicate ת״ז of
-- somebody who has none.
--
-- It also hid those customers from create_ticket, which fills in a ת״ז only
-- where id_number IS NULL.
--
-- The client now sends NULL. This cleans up what is already stored, and the
-- trigger makes sure a blank can never be written again. That matters because
-- browsers still running the old bundle keep sending '' until they reload, and
-- a CHECK constraint would turn their saves into errors.

update public.customers
   set id_number = null
 where id_number is not null
   and btrim(id_number) = '';

create or replace function public.customers_blank_id_number_is_null()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.id_number := nullif(btrim(new.id_number), '');
  return new;
end;
$$;

drop trigger if exists customers_blank_id_number_is_null on public.customers;
create trigger customers_blank_id_number_is_null
  before insert or update of id_number on public.customers
  for each row execute function public.customers_blank_id_number_is_null();
