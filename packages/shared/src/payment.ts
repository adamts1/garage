/* How a garage was paid.

   `tickets.pay_method` and `invoices.pay_method` were free text, and what got
   written into them was whatever Hebrew the screen happened to say. The close
   drawer stored `t('close.methods.card')` — the translated label — so rewording
   a locale file changed the meaning of rows already in the database, and adding
   a second interface language would have made the column say different things
   depending on who took the money. The collect dialog kept its own list of four
   Hebrew words, which was not the drawer's list of five: 'אשראי' and
   'כרטיס אשראי' were the same payment and no code could tell.

   They are codes now, on the same terms as `customers.kind` and `tickets.flags`
   before them: the column holds a value, each app looks up what to call it, and
   a wording change is a wording change. See
   supabase/migrations/20260810000000_payment_methods_are_codes.sql.

   Two audiences read a payment method, and they are not the same audience. The
   operator reads it on a screen, in the app's language — that lookup belongs in
   each app's locale file, keyed on the code. The customer reads it on a printed
   document and in the WhatsApp message, which are composed in the customer's
   language and must not follow the operator's language setting; that is what
   `payMethodHe` is for, and it lives here for the same reason waMessage.ts does. */

/** Every value the column may hold. `other` is the escape hatch — there is
 *  always a payment nobody listed, and the reference field beside it is where
 *  the detail goes. */
export const PAY_METHODS = ['cash', 'card', 'bit', 'bank_transfer', 'cheque', 'other'] as const;

export type PayMethod = (typeof PAY_METHODS)[number];

/** What the collect dialog opens on: most money over a garage counter is cash. */
export const DEFAULT_PAY_METHOD: PayMethod = 'cash';
export const OTHER_PAY_METHOD: PayMethod = 'other';

/* The Hebrew the columns held before the migration, and the near-misses that
   came with them — 'אשראי' from the collect dialog's list and 'כרטיס אשראי'
   from the close drawer's were one payment written two ways. Read-only:
   nothing writes these any more.

   'חיוב פתוח' is deliberately absent. It is not a payment method — the drawer
   wrote it on a ticket nobody had paid — so it resolves to no code at all, and
   the migration clears those rows. */
const LEGACY_PAY_METHODS: Record<string, PayMethod> = {
  'מזומן': 'cash',
  'אשראי': 'card',
  'כרטיס אשראי': 'card',
  'ביט': 'bit',
  'ביט / פייבוקס': 'bit',
  'העברה בנקאית': 'bank_transfer',
  'העברה': 'bank_transfer',
  'צ׳ק': 'cheque',
  "צ'ק": 'cheque',
};

const isPayMethod = (raw: string): raw is PayMethod =>
  (PAY_METHODS as readonly string[]).includes(raw);

/** Whatever the row says → a code this app can translate, or null when there is
 *  nothing to translate: no method recorded, or free text from an import that
 *  no code has a name for. A caller that has to show something falls back to
 *  the raw text rather than rendering a missing translation key at somebody.
 *
 *  This maps the legacy Hebrew too, because the migration that rewrites the
 *  columns and the deploy that ships this code are two separate events. */
export function payMethod(raw: string | null | undefined): PayMethod | null {
  const text = (raw ?? '').trim();
  if (!text) return null;
  if (isPayMethod(text)) return text;
  return LEGACY_PAY_METHODS[text] ?? null;
}

/* What a CUSTOMER is told, on a document or in a message. Not the operator's
   i18n: a printed חשבונית and a WhatsApp to a customer are in Hebrew whatever
   language the counter is set to, and translating the UI must not change what
   the garage sends out. If those documents ever need a second language, they
   need their own decision about whose language wins — the same open question
   waMessage.ts carries. */
const PAY_METHOD_HE: Record<PayMethod, string> = {
  cash: 'מזומן',
  card: 'כרטיס אשראי',
  bit: 'ביט / פייבוקס',
  bank_transfer: 'העברה בנקאית',
  cheque: 'צ׳ק',
  other: 'אחר',
};

/** The Hebrew name of a stored method, or null when nothing was recorded.
 *  Unrecognised free text comes back as itself — a row that says something the
 *  vocabulary has no code for still prints what it says. */
export function payMethodHe(raw: string | null | undefined): string | null {
  const code = payMethod(raw);
  if (code) return PAY_METHOD_HE[code];
  return (raw ?? '').trim() || null;
}

/* One payment among several on a single document.

   A customer who pays part in cash and the rest on a card at the same counter
   visit gets ONE receipt naming both, not a receipt per part. The parts are
   gathered on screen and sent together; the server checks them and the
   provider writes them all onto the one document. */
export interface PaymentPart {
  method: PayMethod;
  /** VAT-inclusive, what the customer handed over by this method. */
  amount: number;
  /** Last four digits, cheque number, transfer reference — whatever the
   *  method asks for, if anything was typed. */
  reference?: string;
  /** A card paid in regular installments (תשלומים, no interest): how many.
   *  Absent or 1 is a single payment. Only ever set on `card`. */
  installments?: number;
  /** A card's details for the receipt, when known: from the clearing provider
   *  for a card charged through the system, typed for one charged elsewhere.
   *  Only ever set on `card`. */
  cardLast4?: string;
  cardType?: CardType;
  approvalNumber?: string;
  /** A card the clearing provider charged: its card_payments row. The server
   *  takes the card's details from that row, and ties the row to the
   *  document so it is never charged or recorded twice. */
  cardPaymentId?: string;
}

export const CARD_TYPES = ['visa', 'mastercard', 'amex', 'diners', 'isracard'] as const;
export type CardType = (typeof CARD_TYPES)[number];

/** Does a part carry anything the ticket's own columns cannot hold? Then it is
 *  sent to the server as a part even when it is the visit's only payment. */
export const partHasCardDetails = (p: PaymentPart): boolean =>
  p.method === 'card' && (partInstallments(p) > 1 || !!p.cardLast4 || !!p.cardType || !!p.approvalNumber || !!p.cardPaymentId);

/** The installments a part names, or 1. */
export const partInstallments = (p: Pick<PaymentPart, 'method' | 'installments'>): number =>
  p.method === 'card' && Number.isInteger(p.installments) && (p.installments ?? 1) > 1 ? p.installments! : 1;

const round2 = (n: number) => Math.round(n * 100) / 100;

/** What the parts add up to. */
export const paymentsTotal = (parts: readonly PaymentPart[]): number =>
  round2(parts.reduce((sum, p) => sum + p.amount, 0));

/** The method that brought in the most, for the one column that names a
 *  single method (`tickets.pay_method`). Null with no parts. Ties go to the
 *  earlier part, which is the one the customer started with. */
export function mainPayMethod(parts: readonly PaymentPart[]): PayMethod | null {
  let best: PaymentPart | null = null;
  for (const p of parts) if (!best || p.amount > best.amount) best = p;
  return best?.method ?? null;
}
