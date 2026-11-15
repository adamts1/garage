-- Sending a finished bookkeeping export to the garage's accountant by email.
--
-- THE FLOW
--
--   1. A garage admin sets the accountant's address (set_accountant_email).
--      Only an admin: whoever can change the address decides where a garage's
--      books go, so a member cannot.
--   2. Anyone in the garage presses "send" on a READY export. The Edge
--      Function send-bookkeeping reads the stored files, checks every one
--      against the size recorded when it was stored, zips them, and sends the
--      zip through Resend — to the accountant, with a copy to whoever pressed
--      the button, who is also the Reply-To.
--   3. Every send is a row below: who it went to, who sent it, and how it
--      ended. That is the history on the export, and the proof it was sent.
--
-- NEVER TWICE BY ACCIDENT
--
-- A row is written as `sending` BEFORE the email goes out, and only one row per
-- export may be `sending` at a time (the partial unique index). Two presses at
-- the same moment: the second insert fails, and nothing is sent twice. The row
-- id is also given to Resend as its idempotency key. Sending again later is
-- allowed — that is a person asking for it, after seeing it was sent.
--
-- A new migration, not an edit to 20261112100000 or 20261115090000: once a
-- migration has run anywhere, it is history.

-- ---------------------------------------------------------------- the address

alter table public.garage_billing
  add column if not exists accountant_email text;

alter table public.garage_billing
  drop constraint if exists garage_billing_accountant_email_check;
/* A sanity check, not validation: one @, something on both sides, a dot in
   the domain, no spaces. Delivery is the real test, and a bounce is recorded
   on the send. */
alter table public.garage_billing
  add constraint garage_billing_accountant_email_check
  check (accountant_email is null or accountant_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$');

comment on column public.garage_billing.accountant_email is
  'Where bookkeeping exports are emailed. Set by a garage admin through set_accountant_email(). See 20261115100000_bookkeeping_email.sql.';

/* Same shape as set_bookkeeping_software: the one door to this column, for an
   admin of THE CURRENT garage only (not is_garage_admin(), which is true for an
   admin of any garage the user belongs to). Empty clears it. */
create or replace function public.set_accountant_email(p_email text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_garage uuid := public.current_garage_id();
  v_email text := nullif(lower(btrim(p_email)), '');
begin
  if v_garage is null then
    raise exception 'no garage for this user' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.garage_members
     where user_id = (select auth.uid()) and garage_id = v_garage and role = 'admin'
  ) then
    raise exception 'only a garage admin can change the accountant''s email' using errcode = '42501';
  end if;
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'that is not an email address' using errcode = '22023';
  end if;

  update public.garage_billing
     set accountant_email = v_email, updated_at = now()
   where garage_id = v_garage;
  if not found then
    raise exception 'this garage is not connected to an accounting provider yet';
  end if;

  return v_email;
end;
$$;

alter function public.set_accountant_email(text) owner to postgres;
revoke all on function public.set_accountant_email(text) from public, anon;
grant execute on function public.set_accountant_email(text) to authenticated;

-- ---------------------------------------------------------------- the sends

create table if not exists public.bookkeeping_export_emails (
  id uuid primary key default gen_random_uuid(),
  export_id uuid not null references public.bookkeeping_exports(id) on delete cascade,
  garage_id uuid not null references public.garages(id) on delete restrict,

  to_email text not null,
  /* The person who pressed send: copied, and the Reply-To. */
  cc_email text,
  sent_by uuid references auth.users(id) on delete set null,
  /* What the attachment was called, so the history says exactly what went. */
  attachment_name text,

  status text not null default 'sending',
  /* Resend's id for the message, once it accepted it. */
  provider_id text,
  error text,

  created_at timestamptz not null default now(),
  sent_at timestamptz,

  constraint bookkeeping_export_emails_status_check
    check (status in ('sending', 'sent', 'error'))
);

/* At most one send in flight per export. This is what turns a double press
   into one email. */
create unique index if not exists bookkeeping_export_emails_one_in_flight
  on public.bookkeeping_export_emails (export_id) where status = 'sending';

create index if not exists bookkeeping_export_emails_export_idx
  on public.bookkeeping_export_emails using btree (export_id, created_at desc);

comment on table public.bookkeeping_export_emails is
  'One row per attempt to email a bookkeeping export. Written by send-bookkeeping only; readable by the garage as the export''s send history.';

alter table public.bookkeeping_export_emails enable row level security;

/* The garage reads its own history. Nothing here is a secret — the addresses
   are the garage's own and its accountant's. Writes are the Edge Function's
   alone: a client that could write here could fake "sent". */
create policy "tenant_isolation" on public.bookkeeping_export_emails
  for select to authenticated
  using (garage_id = (select public.current_garage_id()));

revoke all on table public.bookkeeping_export_emails from anon, authenticated;
grant select on table public.bookkeeping_export_emails to authenticated;
grant all on table public.bookkeeping_export_emails to service_role;
