-- invoices was never published for realtime, so nothing ever listened to it.
--
-- packages/shared/src/invoices.ts has had `subscribeToInvoices` since the
-- ledger screen was built, and the screen wires it to a reload. It subscribes
-- to `public.invoices` — a table that is not in the `supabase_realtime`
-- publication and therefore emits no change events at all. The subscription
-- connected, reported success, and delivered nothing.
--
-- Nothing failed loudly, which is why it lasted: the ledger is correct on load,
-- and every path that issues a document does so from a screen the operator then
-- leaves. It shows when a document is issued from the ledger itself and the new
-- row does not appear until the page is reloaded.
--
-- The other nine operational tables were published in the baseline. This adds
-- the tenth, which the client has been assuming all along.
--
-- Realtime applies the same RLS as a query: a subscriber is sent a change only
-- when the row is one they could have selected, so this broadcasts a garage's
-- documents to that garage and to nobody else — the same rule the tickets table
-- has been published under since the beginning.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'invoices'
  ) then
    alter publication supabase_realtime add table only public.invoices;
  end if;
end $$;

-- REPLICA IDENTITY FULL, matching every other published table here: without it
-- an UPDATE or DELETE event carries only the primary key, and a client that
-- reloads on any change does not care — but one that ever reads the payload
-- would get a row with one column in it.
alter table public.invoices replica identity full;
