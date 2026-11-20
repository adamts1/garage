// The contract every card-clearing provider implements (Pelecard today).
//
// The card-payment function speaks only this interface; each provider is one
// folder (payments/<name>/adapter.ts) that satisfies it, registered in one line of PAYMENT_ADAPTERS there.
// Same shape as the invoicing seam in ../provider.ts, and kept separate from it on
// purpose: the clearing provider takes the money, the invoicing provider writes
// the documents, and a garage may use any pairing of the two.
//
// Card numbers never pass through us. A provider is integrated through a page
// it hosts (or a terminal it drives); we only open that page and read back the
// result.

/** Exactly as stored in garage_payment_secrets.credentials. Provider-defined
 *  (Pelecard: { terminal, user, password }). */
export type PaymentCredentials = Record<string, unknown>;

/** A card brand as a code, whatever the provider calls it. Null when the
 *  provider's answer names none we know. */
export type CardType = 'visa' | 'mastercard' | 'amex' | 'diners' | 'isracard';

export interface StartInput {
  credentials: PaymentCredentials;
  /** Our card_payments.id. Handed to the provider so its record of the
   *  transaction names ours, and checked again when the result is read. */
  paymentId: string;
  /** VAT-inclusive shekels. Each adapter converts to its own unit. */
  amount: number;
  /** Regular installments (no interest), as the advisor chose — 1 for a single
   *  payment. The provider must charge exactly this many, not offer a choice. */
  installments: number;
  /** Shown to whoever looks the transaction up at the provider: the ticket. */
  label: string;
  /** Where the hosted page sends the browser when it is done. Carries no
   *  result we trust — it only tells the screen to go and ask. */
  returnUrl: string;
  /** The garage's physical terminal, when the payment is taken at the counter.
   *  Null → card entry on the page only. Never set for a customer link: a
   *  customer at home must not be able to wake the garage's terminal. */
  posShopNo: string | null;
}

export interface StartedPayment {
  /** Where to send the browser / what to load in the frame. */
  url: string;
  providerTxId: string;
  /** Whatever the provider needs later to validate the result, if anything. */
  confirmationKey: string | null;
}

export interface VerifyInput {
  credentials: PaymentCredentials;
  paymentId: string;
  amount: number;
  installments: number;
  providerTxId: string;
  confirmationKey: string | null;
}

/** The provider's answer, normalized.
 *
 *  'pending' covers everything that is not a verdict: the customer is still
 *  typing, the page expired untouched, the lookup failed, the amounts do not
 *  match, the validation did not confirm. A caller never turns it into
 *  'declined' on its own. */
export type Verdict =
  | {
      status: 'paid';
      amount: number;
      installments: number;
      approvalNumber: string | null;
      cardLast4: string | null;
      cardBrand: string | null;
      cardType: CardType | null;
      raw: unknown;
    }
  | { status: 'declined'; message: string; raw: unknown }
  | { status: 'pending'; message: string | null; raw: unknown };

export interface PaymentProvider {
  start(input: StartInput): Promise<StartedPayment>;
  verify(input: VerifyInput): Promise<Verdict>;
}
