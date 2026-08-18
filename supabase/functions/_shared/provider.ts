// The contract every invoicing provider implements. The handler speaks only
// this interface; each provider (iCount today, others later) is one module that
// satisfies it. Adding a provider changes nothing in the handler beyond one
// line in the ADAPTERS registry.
//
// Everything provider-specific — auth format, payload shape, payment mapping,
// how the document number / allocation number / PDF are fetched — lives behind
// this boundary. The handler passes normalized inputs and stores a normalized
// result, so the invoices table and the whole app stay provider-agnostic.

/** Provider credentials, exactly as stored in garage_billing_secrets.credentials.
 *  Shape is provider-defined (iCount: { cid, token }). */
export type ProviderCredentials = Record<string, unknown>;

export interface InvoiceItem {
  description: string;
  unitprice: number; // pre-VAT
  quantity: number;
}

/** The two kinds of bill. A מס-קבלה is billed and settled at once; a חשבונית מס
 *  is a bill that will be paid later, and is settled by its own receipt. */
export type BillDocType = 'invoice_receipt' | 'tax_invoice';

export interface IssueInput {
  credentials: ProviderCredentials;
  docType: BillDocType;
  customer: { name: string; idNo?: string; address?: string };
  items: InvoiceItem[];
  /** Null on a tax invoice: nothing has been paid, so there is nothing to
   *  describe. Providers that demand a balancing payment must not be given one. */
  payMethod: string | null;
  total: number; // VAT-inclusive, for providers that need a balancing payment
}

/** Money arriving against a tax invoice already issued. */
export interface CollectInput {
  credentials: ProviderCredentials;
  customer: { name: string; idNo?: string };
  payMethod: string | null;
  /** VAT-inclusive — a receipt records a payment, it does not price anything. */
  amount: number;
  /** The tax invoice being settled. */
  basedOnDocnum: string;
}

export interface CancelInput {
  credentials: ProviderCredentials;
  customer: { name: string; idNo?: string };
  items: InvoiceItem[];
  reason: string;
  basedOnDocnum: string; // the document being cancelled
}

/** The normalized result of issuing or cancelling — the legal identity of the
 *  document, whatever the provider. */
export interface IssuedDoc {
  docnum: string;
  docId: string | null;
  pdfUrl: string | null;
  allocationNumber: string | null; // מספר הקצאה, when the provider returns one
  issueDate: string | null;        // ISO date, or null to default to now
}

// ---- expenses (money out) ----
// A supplier expense the garage recorded, pushed to the provider for the
// accountant's books / input-VAT. The provider resolves the supplier and the
// expense category (creating them if needed) and returns the ids to store back.
export interface RecordExpenseInput {
  credentials: ProviderCredentials;
  supplier: {
    name: string;
    taxId?: string;
    email?: string;
    phone?: string;
    providerSupplierId?: string | null; // reuse if already synced
  };
  category: string | null; // maps to a provider expense type
  date: string;            // YYYY-MM-DD
  docnum: string;          // the supplier's document number (required by iCount)
  subtotal: number;        // pre-VAT
  vat: number;
  description?: string;
}

export interface RecordedExpense {
  providerSupplierId: string;
  providerExpenseId: string;
}

// ---- bookkeeping export (the accountant's file) ----
// A range of the garage's books in the format its accounting software imports —
// חשבשבת's movein.dat today. The provider builds it asynchronously and calls
// `webhookUrl` with a download link when it is done, so this returns as soon as
// the order is accepted and carries no file of its own.
export interface ExportBookkeepingInput {
  credentials: ProviderCredentials;
  /** Provider's name for the target format, e.g. iCount's `hash_dos_long`. */
  format: string;
  startDate: string;   // YYYY-MM-DD
  endDate: string;     // YYYY-MM-DD
  docs: boolean;
  expenses: boolean;
  clients: boolean;
  suppliers: boolean;
  /** Where to call back. Carries the export's secret in its path — it is the
   *  only thing that ties a callback to the export that asked for it, since the
   *  order itself comes back with no identifier. */
  webhookUrl: string;
}

export interface InvoiceProvider {
  issue(input: IssueInput): Promise<IssuedDoc>;
  /** Issue a receipt against a tax invoice. Separate from issue() because it
   *  produces a different kind of document: it collects money rather than
   *  billing for anything, so it carries an amount and no lines. */
  collect(input: CollectInput): Promise<IssuedDoc>;
  cancel(input: CancelInput): Promise<IssuedDoc>;
  recordExpense(input: RecordExpenseInput): Promise<RecordedExpense>;
  /** Orders the export. Resolves when the provider has accepted the job, NOT
   *  when the file exists — the callback is what says that. */
  exportBookkeeping(input: ExportBookkeepingInput): Promise<void>;
}
