-- Undo 20261110120000_search_customers_and_cars.sql.
--
-- Run by hand, only after the app has been rolled back to a version that does
-- not call search_customers / search_cars (anything before PR #143): the new
-- app needs both functions to list or find a customer or a car.
--
-- Nothing here touches data: the migration added two functions, a helper and
-- four indexes. pg_trgm stays installed — it is harmless on its own, and
-- something else may come to use it.
--
--   psql "$DB_URL" -f supabase/rollbacks/20261110120000_search_customers_and_cars.down.sql

begin;

drop function if exists public.search_customers(text);
drop function if exists public.search_cars(text);
drop function if exists public.like_escape(text);

drop index if exists public.customers_name_trgm;
drop index if exists public.customers_phone_trgm;
drop index if exists public.cars_plate_key_trgm;
drop index if exists public.customers_garage_phone_key_idx;

-- So `supabase db push` would apply the migration again, should it be wanted.
delete from supabase_migrations.schema_migrations where version = '20261110120000';

commit;
