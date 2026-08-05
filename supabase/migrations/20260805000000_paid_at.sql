-- When a ticket was paid, so the board can let go of it on its own schedule.
--
-- THE BUG THIS EXISTS FOR
--
-- The archive rule was written against the DUE DATE: a paid ticket leaves the
-- board two days after its due date (or, with no due date, after it was
-- opened). For a car paid the day it arrived that is two days away — fine. For
-- one paid a week after its due date, the cutoff is already in the past, so
-- taking the money made the ticket vanish from שולם at the exact moment the
-- garage still wanted to see it: the column that is supposed to show today's
-- takings was empty.
--
-- The rule a garage actually describes is about the payment, not the promise:
-- it stays on the board for the rest of the day it was paid, and is in the
-- archive the next morning. That needs the one fact nobody stored — WHEN it was
-- paid.
--
-- WHY NOT updated_at
--
-- It is already there, and it is wrong. It moves every time anybody touches the
-- row, so a ticket settled last week would climb back onto the board because
-- somebody fixed a typo in its notes, and then leave again a day later. A
-- timestamp that answers "when was this last edited" cannot answer "when was
-- this paid".
--
-- WHY A TRIGGER
--
-- Three clients can move a ticket into שולם — the board's drag, the
-- close-and-charge drawer, and the phone — and a fourth will exist. A stamp
-- each of them has to remember to write is a stamp that is missing from
-- whichever one forgot. Here it is a property of the row instead: status became
-- 'paid' ⇒ paid_at is now. Dragging a ticket back OUT of שולם clears it, so it
-- returns to the board exactly as it did before, and a second payment stamps a
-- second time.

alter table public.tickets add column if not exists paid_at timestamptz;

comment on column public.tickets.paid_at is
  'When the ticket''s status became ''paid'', written by the tickets_stamp_paid_at trigger and cleared if it leaves that status. This is what ages a ticket off the board into the archive — NOT updated_at, which moves on every edit, and not the due date, which is a promise rather than a payment. See isArchived() in @garage/shared.';

/* Everything already settled gets the closest stamp that exists. These tickets
   are all long past the cutoff, so the value only has to be plausible, not
   exact — it decides nothing except that they stay archived. */
update public.tickets
   set paid_at = coalesce(updated_at, created_at)
 where status = 'paid'
   and paid_at is null;

create or replace function public.stamp_paid_at() returns trigger
    language plpgsql
    set search_path to ''
    as $$
begin
  if tg_op = 'INSERT' then
    -- A ticket can be created already settled (an over-the-counter sale).
    if new.status = 'paid' then
      new.paid_at := coalesce(new.paid_at, now());
    end if;
  elsif new.status = 'paid' and old.status is distinct from 'paid' then
    new.paid_at := now();
  elsif new.status is distinct from 'paid' then
    -- Back out of שולם: the clock is off, and the ticket is live again.
    new.paid_at := null;
  end if;
  return new;
end $$;

alter function public.stamp_paid_at() owner to postgres;

comment on function public.stamp_paid_at() is
  'Keeps tickets.paid_at true to the status, whichever client writes it. Set when a ticket enters ''paid'', cleared when it leaves.';

drop trigger if exists tickets_stamp_paid_at on public.tickets;

create trigger tickets_stamp_paid_at
  before insert or update on public.tickets
  for each row execute function public.stamp_paid_at();
