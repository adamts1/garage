-- Publish the bookkeeping export tables for realtime. Neither ever was.
--
-- The export page has subscribed to `bookkeeping_exports` since it was built
-- (subscribeToBookkeepingExports), to turn "being prepared" into "ready" the
-- moment the provider's callback lands. The table was never added to the
-- `supabase_realtime` publication, so the subscription connected, reported
-- success and delivered nothing — the same silent failure invoices had (see
-- 20260820100000_invoices_realtime.sql). A finished export appeared only after
-- a reload.
--
-- `bookkeeping_export_emails` joins it for a reason that matters more: the page
-- warns before sending an export a second time, and it can only warn about a
-- send it knows of. Without this, a send made by someone else in the garage
-- never reaches a page that is already open, and the accountant gets the same
-- files twice with no warning.
--
-- Realtime applies the same RLS as a query, so each garage is sent changes to
-- its own rows only. For bookkeeping_exports that RLS works alongside the
-- column grant: a change event carries only what the subscriber may select, and
-- callback_token / source_url are not selectable.
--
-- A migration of its own: 20261115100000 has already run on staging.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'bookkeeping_exports'
  ) then
    alter publication supabase_realtime add table only public.bookkeeping_exports;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'bookkeeping_export_emails'
  ) then
    alter publication supabase_realtime add table only public.bookkeeping_export_emails;
  end if;
end $$;
