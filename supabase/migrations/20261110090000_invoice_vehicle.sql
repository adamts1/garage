-- The car a document was issued for, frozen with it.
--
-- A garage's bill that cannot say which car it was for is missing the one
-- thing the customer recognises. The printed copy used to read the car off the
-- ticket as it is NOW, which can have moved since — a plate corrected, the
-- mileage of a later visit typed over. Like the customer's name and address,
-- the car is part of what the document said, so it is stored with it:
--
--   { "plate", "car", "km", "opened_at", "closed_at" }
--
-- opened_at is when the car came in (tickets.created_at), closed_at when the
-- work was finished (tickets.closed_at). NULL on documents with no ticket
-- (counter sales), on receipts and credit notes, and on everything issued
-- before this column existed — the print falls back to the ticket for those.
--
-- The lines carry their work the same way, inside the existing `lines` jsonb
-- ({ …, "group", "work", "kind": "work" | "part" }), so no column is needed
-- for that.
--
-- Adding a nullable column rewrites no row, so invoices_immutable (which guards
-- UPDATE and DELETE on issued documents) is not involved.

alter table public.invoices
  add column vehicle jsonb;

alter table public.invoices
  add constraint invoices_vehicle_is_object
  check (vehicle is null or jsonb_typeof(vehicle) = 'object');

comment on column public.invoices.vehicle is
  'The car as the ticket had it when the document was issued: {plate, car, km, opened_at, closed_at}. NULL on documents with no ticket, on receipts and credit notes, and on documents issued before 20261110090000.';
