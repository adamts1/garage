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

export interface IssueInput {
  credentials: ProviderCredentials;
  customer: { name: string; idNo?: string; address?: string };
  items: InvoiceItem[];
  payMethod: string | null;
  total: number; // VAT-inclusive, for providers that need a balancing payment
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

export interface InvoiceProvider {
  issue(input: IssueInput): Promise<IssuedDoc>;
  cancel(input: CancelInput): Promise<IssuedDoc>;
  recordExpense(input: RecordExpenseInput): Promise<RecordedExpense>;
}
