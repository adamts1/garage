/* Card payments taken through the garage's clearing provider (Pelecard first).

   The card-payment Edge Function holds the provider credentials and is the only
   thing that decides whether a card was charged. These are thin calls to it,
   plus one cheap read of whether the garage has a provider at all. */
import { getClient, invokeError } from './client';
import type { CardType, PaymentPart } from './payment';

export type CardPaymentStatus = 'pending' | 'paid' | 'declined';

export interface CardPayment {
  id: string;
  /** The document this payment is on, once there is one. */
  invoiceId: string | null;
  ticketId: string | null;
  amount: number;
  installments: number;
  status: CardPaymentStatus;
  approvalNumber: string | null;
  cardLast4: string | null;
  cardBrand: string | null;
  cardType: CardType | null;
  /** Why it was declined, or why no verdict yet. */
  message: string | null;
}

const rowToPayment = (r: any): CardPayment => ({
  id: r.id,
  invoiceId: r.invoice_id ?? null,
  ticketId: r.ticket_id ?? null,
  amount: Number(r.amount),
  installments: Number(r.installments ?? 1),
  status: r.status,
  approvalNumber: r.approval_number ?? null,
  cardLast4: r.card_last4 ?? null,
  cardBrand: r.card_brand ?? null,
  cardType: r.card_type ?? null,
  message: r.message ?? null,
});

export interface CardSettings {
  /** Charges cards through a clearing provider. False when not connected,
   *  inactive, or unreadable — the card method then records a payment taken
   *  on a separate terminal, as it always has. */
  active: boolean;
  /** A physical terminal is connected to the provider. */
  terminal: boolean;
  /** The provider rejected the credentials and card payments were switched
   *  off by the server. Says why; null when not suspended. */
  suspended: string | null;
  /** Regular installments offered in the drawer: 1..maxInstallments, only on a
   *  payment of at least installmentsMinAmount. They apply whether or not the
   *  provider is connected — a card on a separate terminal can be split too. */
  maxInstallments: number;
  installmentsMinAmount: number;
}

/** The column defaults, for a garage with no row yet. */
export const DEFAULT_CARD_SETTINGS: CardSettings = {
  active: false, terminal: false, suspended: null, maxInstallments: 12, installmentsMinAmount: 0,
};

/** This garage's card settings — one cheap read under RLS. No row is an
 *  ordinary garage (the defaults); a failed read THROWS rather than guessing
 *  "not connected", because recording a card as paid at a garage that charges
 *  cards through the system would be a payment that never happened. */
export const cardPaymentsActive = async (): Promise<CardSettings> => {
  const { data, error } = await getClient()
    .from('garage_payments')
    .select('active, pos_shop_no, max_installments, installments_min_amount, auth_failed_at, auth_error')
    .maybeSingle();
  if (error) throw error;
  if (!data) return DEFAULT_CARD_SETTINGS;
  return {
    active: Boolean(data.active),
    terminal: Boolean(data.active && data.pos_shop_no),
    suspended: data.auth_failed_at ? String(data.auth_error ?? 'credentials rejected') : null,
    maxInstallments: Number(data.max_installments ?? 1),
    installmentsMinAmount: Number(data.installments_min_amount ?? 0),
  };
};

/** How many installments may be offered on `amount`: 1 means none. */
export const installmentsAllowed = (s: Pick<CardSettings, 'maxInstallments' | 'installmentsMinAmount'>, amount: number): number =>
  amount > 0 && amount >= s.installmentsMinAmount ? Math.max(1, Math.floor(s.maxInstallments)) : 1;

/** Why the server would not open a page, when it is something the screen
 *  acts on rather than only shows. */
export type CardStartRefusal =
  | 'payment_open' | 'over_owed' | 'already_paid' | 'nothing_owed'
  /** The provider rejected the garage's credentials; card payments are off
   *  until an admin reconnects them. */
  | 'payments_suspended'
  | 'terminal_failed' | 'no_terminal';

export class CardStartError extends Error {
  constructor(message: string, readonly code: CardStartRefusal | null, readonly payment: CardPayment | null) {
    super(message);
    this.name = 'CardStartError';
  }
}

export type CardStart =
  /** A page to show. */
  | { payment: CardPayment; url: string; recovered: false; direct: false }
  /** No page: the customer already paid on an earlier attempt that no
   *  document records yet. This IS the payment — nothing new was charged. */
  | { payment: CardPayment; url: null; recovered: true; direct: false }
  /** Charged straight on the terminal: the call waited for the customer, and
   *  this is the outcome — paid, declined, or pending when the answer was
   *  lost (verify then finds it in the provider's records). */
  | { payment: CardPayment; url: null; recovered: false; direct: true };

/** Opens a hosted payment page for `amount` on a ticket — or hands back a
 *  payment already taken on it (see CardStart). The server charges the bill's
 *  own figure when `amount` is the rest of it, so read the amount back from
 *  the payment rather than assuming the one asked for.
 *
 *  `claimed`: card payments this visit already took and holds for its
 *  receipt. `force`: open a new page even though an earlier one on the ticket
 *  may still be completed — only after the advisor has been asked. */
export const startCardPayment = async (
  ticketKey: string,
  amount: number,
  installments: number,
  returnOrigin: string,
  opts: { claimed?: readonly string[]; force?: boolean; terminal?: boolean; viaPage?: boolean } = {},
): Promise<CardStart> => {
  const { data: t, error: tErr } = await getClient()
    .from('tickets').select('id').eq('key', ticketKey).single();
  if (tErr) throw tErr;
  const { data, error } = await getClient().functions.invoke('card-payment', {
    body: {
      action: 'start', ticket_id: t.id, amount, installments, return_origin: returnOrigin,
      claimed: opts.claimed ?? [], force: opts.force === true,
      mode: opts.terminal ? 'terminal' : 'page',
      /* On the terminal, but through the provider's page and its terminal
         button — the fallback when the direct call did not work. */
      ...(opts.viaPage ? { via: 'page' } : {}),
    },
  });
  if (error) {
     
    const body: any = await (error as any)?.context?.json?.().catch(() => null);
    if (body?.error) {
      throw new CardStartError(body.error, body.code ?? null, body.payment ? rowToPayment(body.payment) : null);
    }
    throw await invokeError(error);
  }
  if (data.direct) return { payment: rowToPayment(data.payment), url: null, recovered: false, direct: true };
  return data.url
    ? { payment: rowToPayment(data.payment), url: data.url, recovered: false, direct: false }
    : { payment: rowToPayment(data.payment), url: null, recovered: true, direct: false };
};

/** Asks the server — which asks the provider — what became of a payment. */
export const verifyCardPayment = async (paymentId: string): Promise<CardPayment> => {
  const { data, error } = await getClient().functions.invoke('card-payment', {
    body: { action: 'verify', payment_id: paymentId },
  });
  if (error) throw await invokeError(error);
  return rowToPayment(data.payment);
};

/** The card a bill was paid by, and how much of it can still go back to it —
 *  for the credit dialog. Null when the bill was not paid by a card the
 *  provider charged, or nothing is left to return. The card with the most
 *  left is the one a refund uses (issue-invoice decides the same way).
 *  `unresolved`: a refund on it has no clear answer yet, so none can start. */
export const cardRefundable = async (
  invoiceId: string,
): Promise<{ amount: number; last4: string | null; unresolved: boolean } | null> => {
  const db = getClient();
  const { data: receipts, error: e1 } = await db.from('invoices').select('id').eq('pays_invoice_id', invoiceId);
  if (e1) throw e1;
  const docs = [invoiceId, ...(receipts ?? []).map((r) => r.id as string)];
  const { data: cards, error: e2 } = await db.from('card_payments')
    .select('id, amount, card_last4').in('invoice_id', docs).eq('status', 'paid');
  if (e2) throw e2;
  if (!cards?.length) return null;
  const { data: refunds, error: e3 } = await db.from('card_refunds')
    .select('card_payment_id, amount, status').in('card_payment_id', cards.map((c) => c.id));
  if (e3) throw e3;
  const unresolved = (refunds ?? []).some((r) => r.status === 'pending' || r.status === 'unknown');
  const left = cards.map((c) => ({
    last4: (c.card_last4 as string | null) ?? null,
    amount: Math.round((Number(c.amount) - (refunds ?? [])
      .filter((r) => r.card_payment_id === c.id && r.status === 'refunded')
      .reduce((s, r) => s + Number(r.amount), 0)) * 100) / 100,
  })).sort((a, b) => b.amount - a.amount)[0];
  return left.amount > 0 ? { ...left, unresolved } : null;
};

/** The drawer left this attempt (cancelled on the page, stopped, expired).
 *  It stays pending and is still checked before any new charge; it just no
 *  longer makes the next attempt ask whether it may still be paid. Best
 *  effort: a failure here costs only that question. */
export const abandonCardPayment = async (paymentId: string): Promise<void> => {
  await getClient().functions.invoke('card-payment', { body: { action: 'abandon', payment_id: paymentId } }).catch(() => {});
};

/** What goes in the receipt's reference field for a card the provider charged. */
export const cardPaymentReference = (p: CardPayment): string =>
  [p.cardLast4 ? `****${p.cardLast4}` : null, p.approvalNumber ? `אישור ${p.approvalNumber}` : null]
    .filter(Boolean).join(' · ');

/** Cards charged for this ticket that no document records yet — the customer
 *  paid, and the receipt failed (or was never issued). issue-invoice puts them
 *  on the next receipt for the ticket and refuses one that leaves them off;
 *  the ticket page warns while there are any. Only the columns every member
 *  may read, under RLS. */
export const unclaimedCardPayments = async (ticketKey: string): Promise<CardPayment[]> => {
  const db = getClient();
  const { data: t, error: tErr } = await db.from('tickets').select('id').eq('key', ticketKey).maybeSingle();
  if (tErr) throw tErr;
  if (!t) return [];
  const { data, error } = await db.from('card_payments')
    .select('id, invoice_id, ticket_id, amount, installments, status, approval_number, card_last4, card_brand, card_type, message')
    .eq('ticket_id', t.id).eq('status', 'paid').eq('purpose', 'charge').is('invoice_id', null)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(rowToPayment);
};

/** A charged card as one of a visit's payments — what the drawer returns for
 *  it, so a receipt issued later reads exactly like one issued at the time. */
export const chargedPart = (p: CardPayment): PaymentPart => {
  const reference = cardPaymentReference(p);
  return {
    method: 'card',
    amount: p.amount,
    ...(reference ? { reference } : {}),
    ...(p.installments > 1 ? { installments: p.installments } : {}),
    cardPaymentId: p.id,
    ...(p.cardLast4 ? { cardLast4: p.cardLast4 } : {}),
    ...(p.cardType ? { cardType: p.cardType } : {}),
    ...(p.approvalNumber ? { approvalNumber: p.approvalNumber } : {}),
  };
};

/** The other half of what a visit took with no document yet: cash, Bit, a
 *  cheque, a transfer — every part that is not a provider charge (those are
 *  card_payments rows, above). Written when the ticket closes, cleared once a
 *  document records them, so a receipt that failed is issued again with ALL of
 *  the visit's money on it rather than the card alone. Never throws: an empty
 *  list is the old behaviour, not a broken page. */
export const pendingPayments = async (ticketKey: string): Promise<PaymentPart[]> => {
  let data, error;
  try {
    ({ data, error } = await getClient().from('tickets')
      .select('pending_payments').eq('key', ticketKey).maybeSingle());
  } catch {
    return [];
  }
  if (error || !Array.isArray(data?.pending_payments)) return [];
  return (data.pending_payments as PaymentPart[])
    .filter((p) => p && typeof p.method === 'string' && Number(p.amount) > 0)
    .map((p) => ({ ...p, amount: Number(p.amount) }));
};

/** Records (or, with none, clears) the parts pendingPayments() reads. Provider
 *  charges are left out: card_payments already holds them, and a copy here
 *  would put the same card on the receipt twice. */
export const setPendingPayments = async (ticketKey: string, parts: readonly PaymentPart[]): Promise<void> => {
  const kept = parts.filter((p) => !p.cardPaymentId);
  const { error } = await getClient().from('tickets')
    .update({ pending_payments: kept.length > 0 ? kept : null }).eq('key', ticketKey);
  if (error) throw error;
};

/** The terminal check (admin). `credentials`: one call that only asks the
 *  provider whether it accepts the garage's credentials. `card`: a card check
 *  (nothing charged) sent to the terminal — show the page, then verify the
 *  payment as for a charge. Either can switch card payments off (the breaker),
 *  so it is pressed once, on purpose. */
export const checkTerminal = async (
  mode: 'credentials' | 'card',
  returnOrigin: string,
): Promise<{ ok: true } | { payment: CardPayment; url: string }> => {
  const { data, error } = await getClient().functions.invoke('card-payment', {
    body: { action: 'check', mode, return_origin: returnOrigin },
  });
  if (error) {
     
    const body: any = await (error as any)?.context?.json?.().catch(() => null);
    if (body?.error) throw new CardStartError(body.error, body.code ?? null, null);
    throw await invokeError(error);
  }
  return data.ok ? { ok: true } : { payment: rowToPayment(data.payment), url: data.url };
};
