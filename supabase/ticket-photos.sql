/* Photos attached to a service ticket.
   Run this once against the project, after schema.sql.

   The image bytes live in the `ticket-photos` storage bucket; this table holds
   one row per object so the board can list a ticket's photos with a plain query
   (and so a photo can carry a caption). `path` is the object path inside the
   bucket - the public URL is derived client-side with getPublicUrl().

   Like schema.sql this is demo-open: the bucket is public and every policy is
   `using (true)`. There is no login yet, so the anon key is the only caller.
   Both this file and schema.sql need tightening before real customers. */

create table public.ticket_photos (
  id         uuid primary key default gen_random_uuid(),
  ticket_id  uuid not null references public.tickets(id) on delete cascade,
  path       text not null unique,          -- e.g. GAR-142/1737283910000-3f2a.jpg
  caption    text,
  created_at timestamptz not null default now()
);

-- The only query is "this ticket's photos, oldest first".
create index ticket_photos_ticket_id_idx on public.ticket_photos (ticket_id, created_at);

alter table public.ticket_photos enable row level security;
create policy demo_all on public.ticket_photos for all using (true) with check (true);

-- The mobile app and the web board both subscribe to this table.
alter publication supabase_realtime add table public.ticket_photos;

/* ---------- storage ---------- */

-- Public: the web board renders <img src> straight from the CDN, no signing step.
insert into storage.buckets (id, name, public)
values ('ticket-photos', 'ticket-photos', true)
on conflict (id) do nothing;

create policy ticket_photos_read   on storage.objects for select
  using (bucket_id = 'ticket-photos');
create policy ticket_photos_insert on storage.objects for insert
  with check (bucket_id = 'ticket-photos');
create policy ticket_photos_delete on storage.objects for delete
  using (bucket_id = 'ticket-photos');

/* Note: deleting a ticket cascades the rows here, but NOT the objects in the
   bucket - Postgres cascade doesn't reach storage. Client-side deletes remove
   the object first, then the row (see mobile/lib/db.ts deleteTicketPhoto).
   Orphaned objects from a cascaded ticket delete are harmless but do accumulate;
   a scheduled cleanup is the follow-up if that ever matters. */
