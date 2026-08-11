-- Photos a customer can actually open, and no more than two of them per ticket.
--
-- WHAT WAS WRONG
--
-- The WhatsApp message carries a photo as the same signed URL the app renders
-- from: ~330 characters of path and JWT, wrapped over four lines in the chat,
-- and valid for eight hours. A customer who reads the message the next morning
-- taps a dead link. The message was shipping a session token to someone who has
-- no session, and calling it a photo.
--
-- WHAT REPLACES IT
--
-- A share code per photo: ten characters out of an unambiguous alphabet, which
-- makes a link like
--
--   https://<project>.supabase.co/functions/v1/photo/k3f9x2m7qb
--
-- The `photo` Edge Function looks the code up and redirects to a signed URL it
-- mints on the spot, so the link is short, it is one line, and it works for as
-- long as the photo exists rather than for eight hours.
--
-- The code IS the credential — anyone holding it sees the photo, which is the
-- point of sending it to a customer who has no account. Fifty bits of entropy
-- and no listing endpoint is what stands between a stranger and a stranger's
-- bumper. That is the same trade the bucket made when it was public, except now
-- it is per photo rather than per garage, and a photo that is deleted takes its
-- link with it.

/* Ten characters from a 32-symbol alphabet - 50 bits.
 *
 * No l/1/o/0: these get read aloud and typed by hand often enough that the pairs
 * that look alike are not worth the two extra bits.
 *
 * Uniqueness is the index below, not this function. At 50 bits a collision needs
 * millions of photos before it is worth a thought, and if one ever happens the
 * insert fails loudly rather than handing two tickets the same link. */
create or replace function public.new_photo_share_code() returns text
    language sql volatile
    set search_path to ''
    as $$
  select string_agg(
           substr('abcdefghijkmnpqrstuvwxyz23456789', (get_byte(bytes, i) % 32) + 1, 1),
           ''
         )
  from (select extensions.gen_random_bytes(10) as bytes) g,
       generate_series(0, 9) as i
$$;

alter function public.new_photo_share_code() owner to postgres;

comment on function public.new_photo_share_code() is
  'A photo''s public share code: ten characters, 50 bits, no look-alike glyphs. Uniqueness is enforced by ticket_photos_share_code_key, not here.';

alter table public.ticket_photos
  add column if not exists share_code text default public.new_photo_share_code();

-- Photos taken before this migration get one too, or their WhatsApp links stay
-- broken. One statement, one code each: the default is volatile, so it is
-- re-evaluated per row.
update public.ticket_photos
   set share_code = public.new_photo_share_code()
 where share_code is null;

alter table public.ticket_photos
  alter column share_code set not null;

alter table public.ticket_photos
  drop constraint if exists ticket_photos_share_code_key;
alter table public.ticket_photos
  add constraint ticket_photos_share_code_key unique (share_code);

comment on column public.ticket_photos.share_code is
  'The token in the customer-facing link (/functions/v1/photo/<code>). A bearer credential: whoever holds it can view this one photo, which is why it is random rather than derived from the id.';


/* Two photos to a ticket.
 *
 * A cap the client also draws - the phone hides the camera buttons at two - but
 * a hidden button is a preference, not a limit. This is the limit.
 *
 * FOR UPDATE on the ticket first, so two uploads racing cannot both count one
 * and both insert. It locks a single row and the transaction takes no other, so
 * there is no pair of locks to deadlock over.
 *
 * Existing tickets are left alone: this fires on insert only, so a ticket that
 * already carries five photos keeps them and simply cannot gain a sixth. */
create or replace function public.enforce_ticket_photo_limit() returns trigger
    language plpgsql
    set search_path to ''
    as $$
declare
  existing integer;
begin
  perform 1 from public.tickets where id = new.ticket_id for update;

  select count(*) into existing
    from public.ticket_photos
   where ticket_id = new.ticket_id;

  if existing >= 2 then
    raise exception 'a ticket may hold at most 2 photos'
      using errcode = 'check_violation', hint = 'delete one before adding another';
  end if;

  return new;
end
$$;

alter function public.enforce_ticket_photo_limit() owner to postgres;

drop trigger if exists ticket_photos_limit on public.ticket_photos;
create trigger ticket_photos_limit
  before insert on public.ticket_photos
  for each row execute function public.enforce_ticket_photo_limit();

comment on function public.enforce_ticket_photo_limit() is
  'At most two photos per ticket. INSERT only, so tickets that already hold more keep them.';
