-- ============================================================
--  Add the "שולם" (paid) board status.
--
--  מוכן לאיסוף ('done')  = the car is ready, NOT paid yet
--  שולם        ('paid')  = the ticket has been paid
--
--  Run this in the Supabase SQL Editor BEFORE using the new column,
--  otherwise the DB rejects the status with a check-constraint error.
-- ============================================================

alter table public.tickets drop constraint if exists tickets_status_check;

alter table public.tickets add constraint tickets_status_check
  check (status in ('todo','diag','appr','prog','parts','qa','done','paid'));
