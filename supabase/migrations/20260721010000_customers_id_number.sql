-- ת״ז belongs to the customer, not to the job.
--
-- The new-ticket form has always had an ID-number input, but nothing ever
-- stored what it collected (see docs/PRODUCTION.md §3.10). Wiring it up raised
-- the question of where it belongs: tickets.id_number already existed, but a
-- national ID identifies a person, not a repair. Storing it per ticket would
-- re-enter and duplicate the same number across every visit, and leave no
-- single place to correct it.
--
-- On the customer it is entered once and autofills thereafter, alongside name,
-- phone and address. Phase 4a can then snapshot it onto an issued invoice from
-- the customer record.
--
-- tickets.id_number is left in place and unused. Every value is NULL, dropping
-- a column is irreversible, and it costs nothing to leave. If it is still
-- unused by the time tenancy settles, remove it deliberately then.
--
-- PRIVACY: this makes the system store national ID numbers for the first time.
-- That is a deliberate choice, not an inherited default, and it raises the bar
-- on the §6 privacy review — retention, access and deletion all now have a
-- sensitive identifier in scope.

alter table public.customers add column if not exists id_number text;

comment on column public.customers.id_number is
  'ת״ז / company registration number. Sensitive personal data — see docs/PRODUCTION.md §6.';
