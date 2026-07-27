-- ============================================================
--  Phase 4a — per-garage invoicing configuration.
--
--  Invoicing is NOT global. Each garage bills through its own provider account
--  (the pilot uses iCount). Sharing one provider account across tenants would
--  undo the tenant isolation Phases 2c/3 established — a garage's tax documents
--  must land in that garage's books, nobody else's.
--
--  NOTE: this migration creates the FIRST (iCount-shaped) form of the config.
--  20260727020000 then generalises it to a provider-agnostic credentials bag so
--  a second accounting service is one adapter away. The two are kept separate
--  because this one was already applied to staging before the generalisation —
--  editing an applied migration in place is the history drift this repo avoids.
--
--  The config splits in two on purpose:
--
--   * garage_billing         — non-secret settings (which provider, the iCount
--     company id, VAT rate, whether issuing is switched on). The garage's own
--     members may READ this so the UI can show "invoicing connected". No client
--     write: turning issuing on, or changing the account, is an admin action.
--
--   * garage_billing_secrets — the API token, ALONE, with NO grant to
--     authenticated or anon at all. RLS is on with no policy for them, and there
--     is no table grant either, so a client cannot read it even by accident. Only
--     service_role (the Edge Function) reads it. The token therefore never enters
--     a client bundle or a PostgREST response.
-- ============================================================

create table if not exists public.garage_billing (
  garage_id   uuid primary key references public.garages(id) on delete cascade,
  provider    text not null default 'icount',
  icount_cid  text,                        -- iCount company id; identifies the account
  -- What this garage issues when a ticket is billed. Only invoice-receipt for the
  -- pilot; the credit note is issued to cancel, never chosen at billing time.
  doc_type    text not null default 'invoice_receipt'
              check (doc_type in ('invoice_receipt')),
  vat_rate    numeric(5,4) not null default 0.18,   -- Israel VAT, 18% since 2025-01
  active      boolean not null default false,        -- issuing is off until creds verified
  updated_at  timestamptz not null default now()
);

alter table public.garage_billing enable row level security;
grant select on public.garage_billing to authenticated;   -- read own; no write
grant select, insert, update on public.garage_billing to service_role;

drop policy if exists garage_billing_read on public.garage_billing;
create policy garage_billing_read on public.garage_billing
  for select to authenticated
  using (garage_id = (select public.current_garage_id()));

-- ---------- the token, isolated ----------
create table if not exists public.garage_billing_secrets (
  garage_id     uuid primary key references public.garages(id) on delete cascade,
  icount_token  text not null,
  updated_at    timestamptz not null default now()
);

-- RLS on as defence-in-depth, but the real lock is the absence of any grant to
-- authenticated/anon: they cannot SELECT this table at all. service_role bypasses
-- RLS and is the only role with a grant.
alter table public.garage_billing_secrets enable row level security;
grant select, insert, update, delete on public.garage_billing_secrets to service_role;
-- deliberately NO grant to authenticated or anon, and no policy for them.
