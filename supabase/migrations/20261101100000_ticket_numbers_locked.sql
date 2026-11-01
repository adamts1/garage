-- A ticket's number is the garage's, given once, in order, and never changed.
--
-- garage_counters already hands out GAR-/W- numbers per garage under a row
-- lock, inside create_ticket, and (since 20261101090000) a ticket can no longer
-- be deleted out of the sequence. Two ways round it were left:
--
--   1. INSERT straight into tickets. RLS lets a member write rows for their own
--      garage, and nothing checked the key, so a direct API call could file
--      GAR-5000 into a garage on GAR-40 — a jump in the sequence, and a ticket
--      creation that fails with a duplicate key the day the counter gets there.
--   2. UPDATE key / job / garage_id on an existing ticket, which renumbers it:
--      a hole where it was, and paperwork naming a number that no longer exists.
--
-- Now: a signed-in user's insert is accepted only with the numbers the counter
-- just handed out — which in practice means only through create_ticket, since
-- a number is taken in the same transaction as the insert and any other
-- transaction finds it already used. The service role (seed scripts, support
-- fixes) is not held to it: it writes its own numbers and raises the counter
-- past them, see scripts/seed-board.mjs. Renumbering is refused for everyone.

create or replace function public.tickets_lock_numbers() returns trigger
    language plpgsql
    security definer
    set search_path to ''
    as $$
declare
  c public.garage_counters;
begin
  if tg_op = 'UPDATE' then
    if new.key is distinct from old.key
       or new.job is distinct from old.job
       or new.garage_id is distinct from old.garage_id then
      raise exception 'ticket % cannot be renumbered or moved to another garage', old.key
        using errcode = '42501';
    end if;
    return new;
  end if;

  if coalesce(auth.role(), '') in ('authenticated', 'anon') then
    select * into c from public.garage_counters where garage_id = new.garage_id;
    if c.garage_id is null
       or new.key is distinct from 'GAR-' || c.last_ticket
       or new.job is distinct from 'W-' || c.last_job then
      raise exception 'ticket numbers are assigned by create_ticket' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

alter function public.tickets_lock_numbers() owner to postgres;

comment on function public.tickets_lock_numbers() is
  'A user''s ticket insert must carry the numbers garage_counters just assigned (i.e. come through create_ticket); no ticket may change key, job or garage. See 20261101100000_ticket_numbers_locked.sql.';

drop trigger if exists tickets_lock_numbers on public.tickets;
create trigger tickets_lock_numbers
  before insert or update on public.tickets
  for each row execute function public.tickets_lock_numbers();
