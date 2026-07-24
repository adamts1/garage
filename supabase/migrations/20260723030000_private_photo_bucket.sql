-- ============================================================
--  Phase 2c — the photo bucket stops being public.
--
--  ticket-photos has been a PUBLIC bucket with policies that check only
--  `bucket_id = 'ticket-photos'`. That means anyone who learns an object's URL
--  can fetch it forever, without a session, from any network — and the URL is a
--  plain CDN link with no signature and no expiry. Ticket photos are pictures of
--  customers' cars, frequently including number plates, sometimes including the
--  inside of their vehicle.
--
--  Worse than guessable: until this migration the row carrying the path was
--  readable by anon too, so the paths did not need guessing at all.
--
--  Two changes. The bucket becomes private, so every read needs a signed URL
--  minted for a caller the database has already authorised. And the policies
--  become garage-scoped rather than bucket-scoped.
--
--  ---- why the policies are shaped the way they are ----
--
--  New uploads are written to `<garage_id>/<ticket key>/<file>`, so the object's
--  own name proves which garage it belongs to and INSERT can be checked without
--  a lookup — which matters, because at upload time the ticket_photos row does
--  not exist yet.
--
--  SELECT and DELETE accept EITHER a garage-prefixed name OR an object claimed
--  by a ticket_photos row in the caller's garage. That second arm is what keeps
--  photos uploaded before this migration readable: their paths start with the
--  ticket key and cannot be rewritten from SQL, because moving a stored object
--  is a storage API call, not an UPDATE. The row is the authority on ownership;
--  the prefix is an optimisation that also covers the case where no row exists.
--
--  That no-row case is real: uploadTicketPhoto writes the object first and the
--  row second, and removes the object again if the row insert fails. Without the
--  prefix arm, that rollback would be refused and would leave an orphan.
-- ============================================================

update storage.buckets set public = false where id = 'ticket-photos';

-- ticket_photos.path is now consulted by a storage policy on every object read,
-- so it needs an index; without one this is a sequential scan per photo.
create index if not exists ticket_photos_path_idx on public.ticket_photos (path);

drop policy if exists ticket_photos_read   on storage.objects;
drop policy if exists ticket_photos_insert on storage.objects;
drop policy if exists ticket_photos_delete on storage.objects;

create policy ticket_photos_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'ticket-photos'
    and (
      name like (select public.current_garage_id())::text || '/%'
      or exists (
        select 1 from public.ticket_photos p
        where p.path = storage.objects.name
          and p.garage_id = (select public.current_garage_id())
      )
    )
  );

-- Prefix only. A caller may write into their own garage's folder and nowhere
-- else, and there is no row yet to consult.
create policy ticket_photos_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'ticket-photos'
    and name like (select public.current_garage_id())::text || '/%'
  );

create policy ticket_photos_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'ticket-photos'
    and (
      name like (select public.current_garage_id())::text || '/%'
      or exists (
        select 1 from public.ticket_photos p
        where p.path = storage.objects.name
          and p.garage_id = (select public.current_garage_id())
      )
    )
  );

-- anon keeps nothing. There is no policy for it on storage.objects at all, which
-- together with the private bucket means an unsigned URL is refused even if
-- someone still has one written down.
