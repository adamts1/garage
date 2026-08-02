-- The board is four columns: כניסה, ממתין לאישור, מוכן, שולם.
--
-- It was eight in the database and six on screen — todo, diag, appr, prog,
-- parts, qa, done, paid — of which `diag` and `qa` were never rendered at all,
-- so a ticket that reached one vanished from the board with no column to sit
-- in. The four that remain are the states a garage actually acts on: the car is
-- here, the customer has to approve, the car is ready, the money is in.
--
-- Existing tickets are MAPPED, not deleted. Anything that meant "in the shop
-- and not ready" — diag, prog, parts, qa — becomes `todo`, which is what כניסה
-- says. Nothing is dropped: a ticket keeps its works, its parts, its history
-- and its blocker note, and `blocked` survives as a note on the card now that
-- it is no longer a column of its own.
--
-- The update runs BEFORE the constraint is replaced, or the new constraint
-- would be validated against rows the old one still allows and the migration
-- would fail on any garage with a ticket in flight.

update public.tickets
   set status = 'todo'
 where status in ('diag', 'prog', 'parts', 'qa');

alter table public.tickets drop constraint if exists tickets_status_check;

alter table public.tickets
  add constraint tickets_status_check
  check (status = any (array['todo'::text, 'appr'::text, 'done'::text, 'paid'::text]));

comment on column public.tickets.status is
  'One of four board columns: todo (כניסה), appr (ממתין לאישור), done (מוכן), paid (שולם). The ids are kept as they were so no client, export or saved link has to be rewritten — only the set shrank. See COLUMNS in packages/shared/src/types.ts, which must list exactly these four.';
