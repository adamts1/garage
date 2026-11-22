-- Money back to a card, through the clearing provider — 2026-11-22.
--
-- A credit note (חשבונית זיכוי) is the document; this is the money. When an
-- invoice was paid by a card the provider charged, issue-invoice's credit
-- action can return the credited sum to that card first, and only then issue
-- the credit note. One row per attempt to return money.
--
-- Checked against Pelecard's sandbox on 2026-11-20:
--   * same day, before the nightly broadcast: the whole transaction can be
--     CANCELLED (it never reaches the card); after it, CancelTransaction answers
--     510 and the money has to be REFUNDED (a credit transaction);
--   * a refund may be partial and repeated — and Pelecard does NOT stop the
--     refunds adding up to more than was charged. That limit is ours, below
--     and in issue-invoice.

-- The provider's own id for the charge, which a refund names. Pelecard:
-- TransactionPelecardId from the verified result.
alter table public.card_payments add column if not exists provider_ref text;
update public.card_payments
   set provider_ref = raw->'ResultData'->>'TransactionPelecardId'
 where provider_ref is null
   and status = 'paid'
   and coalesce(raw->'ResultData'->>'TransactionPelecardId', '') <> '';

-- The column grant on card_payments names its columns; this one is new.
grant select (provider_ref) on table public.card_payments to authenticated;

create table if not exists public.card_refunds (
  id                 uuid primary key default gen_random_uuid(),
  garage_id          uuid not null references public.garages(id) on delete cascade,
  card_payment_id    uuid not null references public.card_payments(id) on delete cascade,
  /* The bill whose credit asked for it. */
  invoice_id         uuid not null references public.invoices(id) on delete cascade,
  amount             numeric(12,2) not null check (amount > 0),
  /* cancel: the charge voided before it was broadcast. refund: a credit
     transaction after. Null until the provider has answered. */
  kind               text check (kind in ('cancel', 'refund')),
  /* pending: being asked now. refunded: the provider returned it — final.
     failed: the provider said no — nothing moved. unknown: no clear answer
     (a timeout, a dropped connection) — money MAY have moved, so nothing
     further is refunded from this payment until a person has checked. */
  status             text not null default 'pending'
                     check (status in ('pending', 'refunded', 'failed', 'unknown')),
  provider_refund_id text,
  message            text,
  raw                jsonb,
  /* The credit note that records it — set once, when that document is
     stored. A refunded row with none is money returned that no document shows
     yet; the next credit on the bill uses it instead of refunding again. */
  credit_note_id     uuid references public.invoices(id) on delete set null,
  created_by         uuid references auth.users(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

alter table public.card_refunds owner to postgres;
create index if not exists card_refunds_payment on public.card_refunds (card_payment_id);
create index if not exists card_refunds_invoice on public.card_refunds (invoice_id);

/* One unresolved refund per payment at a time. A second press, a second tab,
   or a refund whose answer never came — each stops here, not at the card. */
create unique index if not exists card_refunds_one_open
  on public.card_refunds (card_payment_id) where status in ('pending', 'unknown');

alter table public.card_refunds enable row level security;

create policy card_refunds_read on public.card_refunds
  for select to authenticated
  using (garage_id = (select public.current_garage_id()));

revoke all on table public.card_refunds from anon, authenticated;
grant select (id, garage_id, card_payment_id, invoice_id, amount, kind, status,
              provider_refund_id, message, credit_note_id, created_by, created_at, updated_at)
  on table public.card_refunds to authenticated;
grant all on table public.card_refunds to service_role;

/* Refunded is final, the amount never changes, and the credit note is set
   once. 'unknown' may still be resolved — by a person who checked — to
   refunded or failed. */
create or replace function public.card_refunds_settle_once()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.amount is distinct from old.amount or new.card_payment_id is distinct from old.card_payment_id then
    raise exception 'card refund % cannot change its amount or payment', old.id;
  end if;
  if old.status = 'refunded' and new.status <> 'refunded' then
    raise exception 'card refund % is refunded and cannot change', old.id;
  end if;
  if old.credit_note_id is not null and new.credit_note_id is distinct from old.credit_note_id then
    raise exception 'card refund % is already on a credit note', old.id;
  end if;
  if new.credit_note_id is not null and new.status <> 'refunded' then
    raise exception 'card refund % is not refunded and cannot go on a credit note', old.id;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

alter function public.card_refunds_settle_once() owner to postgres;
revoke all on function public.card_refunds_settle_once() from public, anon, authenticated;

drop trigger if exists card_refunds_settle_once on public.card_refunds;
create trigger card_refunds_settle_once
  before update on public.card_refunds
  for each row execute function public.card_refunds_settle_once();
