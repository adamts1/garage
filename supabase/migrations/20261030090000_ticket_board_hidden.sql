-- A ticket can be taken off the board without being closed.
--
-- The board is what the floor looks at, and some tickets sit on it for weeks
-- with nothing left to do — a car waiting on a part from abroad, a quote the
-- customer has not answered. They crowd out the cars that are actually in the
-- bay. Hiding one is a view choice, not a status: it keeps its column, its
-- works and its money, it still shows in the table view, and it can be put
-- back on the board from there at any time.
--
-- A column rather than a per-browser setting, because the board is shared: the
-- advisor who tidies it tidies it for the mechanics too.
--
-- NOT NULL with a default, so every existing ticket stays on the board and a
-- client that has never heard of the column (the phone app, an old bundle)
-- leaves it alone — ticketToRow sends only the columns it knows.

alter table public.tickets
  add column if not exists board_hidden boolean not null default false;

comment on column public.tickets.board_hidden is
  'Taken off the web board by hand. A view choice, not a status: the ticket keeps its column and still shows in the table view, from where it can be put back.';
