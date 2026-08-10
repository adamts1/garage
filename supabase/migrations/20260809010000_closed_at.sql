-- When the work on a ticket was finished, so a debt can be aged from it.
--
-- WHAT THIS IS FOR
--
-- An aging report sorts what customers owe by how long they have owed it. A
-- garage knows roughly what it is owed; what it does not know is which part has
-- been sitting there since March. That needs a date the debt starts from, and
-- for a job that is finished and unpaid the honest date is the day the work was
-- done — not the day it was invoiced, because a garage that closes a job and
-- bills it three weeks later has been owed that money for three weeks.
--
-- WHY NOT ONE OF THE COLUMNS ALREADY THERE
--
--   `due`        is free text, and always has been: rows in this very database
--                hold 'צפי 23/07', 'ממתין אישור' and 'איסוף היום'. It is a note
--                to the advisor about when the car will be ready, not a date any
--                arithmetic can be done on. Aging by it would silently bucket
--                every debt as brand new, which is a report that lies quietly.
--   `updated_at` moves whenever anybody touches the row, so a job finished in
--                March would look a day old because somebody fixed a typo in its
--                notes. This is the same reason paid_at exists (20260805000000)
--                rather than the archive reading updated_at.
--   `created_at` is when the car ARRIVED. Real, and the wrong question: a
--                gearbox that took three weeks in the shop is not three weeks
--                overdue the day it is finished.
--
-- So: the same shape as paid_at, for the same reasons. A stamp each client has
-- to remember to write is a stamp missing from whichever one forgot, and there
-- are already three that can move a ticket into 'done'.
--
-- 'paid' also counts as finished. A ticket can go straight from work-in-progress
-- to settled without pausing in 'done' — the close-and-charge drawer does
-- exactly that — and it would be perverse for the fast path to lose the date.

alter table public.tickets add column if not exists closed_at timestamptz;

comment on column public.tickets.closed_at is
  'When the work was finished — the ticket first reached ''done'' or ''paid''. Written by the tickets_stamp_closed_at trigger, cleared if the ticket goes back to open work. This is what ages an unpaid debt in the aging report; NOT `due`, which is free text, and not updated_at, which moves on every edit.';

/* Everything already finished gets the closest stamp that exists. paid_at is
   exactly right where it is set; for the rest updated_at is the best guess
   available, and being approximate on history that predates the column is
   better than a report that starts empty. */
update public.tickets
   set closed_at = coalesce(paid_at, updated_at, created_at)
 where status in ('done', 'paid')
   and closed_at is null;

create or replace function public.stamp_closed_at() returns trigger
    language plpgsql
    set search_path to ''
    as $$
declare
  finished boolean := new.status in ('done', 'paid');
begin
  if tg_op = 'INSERT' then
    if finished then
      new.closed_at := coalesce(new.closed_at, now());
    end if;
    return new;
  end if;

  /* Only the FIRST arrival is stamped: 'done' → 'paid' is the same job
     finishing and then being paid for, and re-stamping on the second step would
     restart the clock on a debt at the moment it is settled — precisely
     backwards. Going back to open work clears it, so a job reopened for a
     comeback is not still aging against its first visit. */
  if finished and old.status not in ('done', 'paid') then
    new.closed_at := now();
  elsif not finished then
    new.closed_at := null;
  end if;
  return new;
end $$;

alter function public.stamp_closed_at() owner to postgres;

comment on function public.stamp_closed_at() is
  'Keeps tickets.closed_at true to the status, whichever client writes it. Set when a ticket first reaches ''done'' or ''paid'', left alone as it moves between them, cleared if it returns to open work.';

drop trigger if exists tickets_stamp_closed_at on public.tickets;

create trigger tickets_stamp_closed_at
  before insert or update on public.tickets
  for each row execute function public.stamp_closed_at();
