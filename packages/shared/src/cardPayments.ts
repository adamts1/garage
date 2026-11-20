/* Card payments taken through the garage's clearing provider (Pelecard first).

   The card-payment Edge Function holds the provider credentials and is the only
   thing that decides whether a card was charged. These are thin calls to it,
   plus one cheap read of whether the garage has a provider at all. */
import { getClient, invokeError } from './client';
import type { CardType } from './payment';

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
  /** Regular installments offered in the drawer: 1..maxInstallments, only on a
   *  payment of at least installmentsMinAmount. They apply whether or not the
   *  provider is connected — a card on a separate terminal can be split too. */
  maxInstallments: number;
  installmentsMinAmount: number;
}

/** The column defaults, for a garage with no row yet. */
export const DEFAULT_CARD_SETTINGS: CardSettings = {
  active: false, terminal: false, maxInstallments: 12, installmentsMinAmount: 0,
};

/** This garage's card settings — one cheap read under RLS. No row is an
 *  ordinary garage (the defaults); a failed read THROWS rather than guessing
 *  "not connected", because recording a card as paid at a garage that charges
 *  cards through the system would be a payment that never happened. */
export const cardPaymentsActive = async (): Promise<CardSettings> => {
  const { data, error } = await getClient()
    .from('garage_payments')
    .select('active, pos_shop_no, max_installments, installments_min_amount')
    .maybeSingle();
  if (error) throw error;
  if (!data) return DEFAULT_CARD_SETTINGS;
  return {
    active: Boolean(data.active),
    terminal: Boolean(data.active && data.pos_shop_no),
    maxInstallments: Number(data.max_installments ?? 1),
    installmentsMinAmount: Number(data.installments_min_amount ?? 0),
  };
};

/** How many installments may be offered on `amount`: 1 means none. */
export const installmentsAllowed = (s: Pick<CardSettings, 'maxInstallments' | 'installmentsMinAmount'>, amount: number): number =>
  amount > 0 && amount >= s.installmentsMinAmount ? Math.max(1, Math.floor(s.maxInstallments)) : 1;

/** Why the server would not open a page, when it is something the screen
 *  acts on rather than only shows. */
export type CardStartRefusal = 'payment_open' | 'over_owed' | 'already_paid' | 'nothing_owed';

export class CardStartError extends Error {
  constructor(message: string, readonly code: CardStartRefusal | null, readonly payment: CardPayment | null) {
    super(message);
    this.name = 'CardStartError';
  }
}

export type CardStart =
  /** A page to show. */
  | { payment: CardPayment; url: string; recovered: false }
  /** No page: the customer already paid on an earlier attempt that no
   *  document records yet. This IS the payment — nothing new was charged. */
  | { payment: CardPayment; url: null; recovered: true };

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
  opts: { claimed?: readonly string[]; force?: boolean } = {},
): Promise<CardStart> => {
  const { data: t, error: tErr } = await getClient()
    .from('tickets').select('id').eq('key', ticketKey).single();
  if (tErr) throw tErr;
  const { data, error } = await getClient().functions.invoke('card-payment', {
    body: {
      action: 'start', ticket_id: t.id, amount, installments, return_origin: returnOrigin,
      claimed: opts.claimed ?? [], force: opts.force === true,
    },
  });
  if (error) {
     
    const body: any = await (error as any)?.context?.json?.().catch(() => null);
    if (body?.error) {
      throw new CardStartError(body.error, body.code ?? null, body.payment ? rowToPayment(body.payment) : null);
    }
    throw await invokeError(error);
  }
  return data.url
    ? { payment: rowToPayment(data.payment), url: data.url, recovered: false }
    : { payment: rowToPayment(data.payment), url: null, recovered: true };
};

/** Asks the server — which asks the provider — what became of a payment. */
export const verifyCardPayment = async (paymentId: string): Promise<CardPayment> => {
  const { data, error } = await getClient().functions.invoke('card-payment', {
    body: { action: 'verify', payment_id: paymentId },
  });
  if (error) throw await invokeError(error);
  return rowToPayment(data.payment);
};

/** What goes in the receipt's reference field for a card the provider charged. */
export const cardPaymentReference = (p: CardPayment): string =>
  [p.cardLast4 ? `****${p.cardLast4}` : null, p.approvalNumber ? `אישור ${p.approvalNumber}` : null]
    .filter(Boolean).join(' · ');
