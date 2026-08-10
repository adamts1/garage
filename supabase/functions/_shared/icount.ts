// iCount — one InvoiceProvider adapter. All iCount specifics (verified against a
// live account on 2026-07-27) are contained here: auth is a Bearer token header
// PLUS the cid in the POST body; invrec = חשבונית מס-קבלה, refund = חשבונית זיכוי;
// doc/create returns only docnum + doc_url, so doc/info fetches doc_id and the
// allocation number; an invrec is rejected unless a payment block balances the
// total. To add another provider, write a sibling module exporting the same
// InvoiceProvider shape — nothing here needs to change.

import type {
  InvoiceProvider, IssueInput, CollectInput, CancelInput, IssuedDoc, ProviderCredentials,
  RecordExpenseInput, RecordedExpense,
} from './provider.ts';

const BASE = 'https://api.icount.co.il/api/v3.php';

interface IcountCreds { cid: string; token: string }

function readCreds(c: ProviderCredentials): IcountCreds {
  const cid = c.cid as string | undefined;
  const token = c.token as string | undefined;
  if (!cid || !token) throw new Error('iCount credentials must include cid and token');
  return { cid, token };
}

async function call(c: IcountCreds, path: string, body: Record<string, unknown>) {
  const res = await fetch(`${BASE}/${path}`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${c.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ cid: c.cid, ...body }),
  });
  const data = await res.json();
  if (!data?.status) {
    // error_details is often an empty array even on failure; fall back to the
    // description/reason so the message is never blank (e.g. "Token expired").
    const detail = (Array.isArray(data?.error_details) && data.error_details.length)
      ? data.error_details.join('; ')
      : (data?.error_description ?? data?.reason ?? 'iCount request failed');
    throw new Error(`iCount ${path}: ${detail}`);
  }
  return data;
}

/* iCount's names for the four documents. invrec and refund were verified against
   a live account on 2026-07-27; invoice and receipt are iCount's documented
   codes for חשבונית מס and קבלה and have NOT been exercised against a real
   account yet — see docs/PRODUCTION.md. */
const DOCTYPE = {
  invoice_receipt: 'invrec',
  tax_invoice: 'invoice',
  receipt: 'receipt',
  credit_note: 'refund',
} as const;

/** iCount rejects an invrec whose payments don't total the document. Only one
 *  payment key is set; cash is verified, the rest are best-effort. */
function paymentBlock(method: string | null, total: number): Record<string, unknown> {
  const m = (method ?? '').toLowerCase();
  if (m.includes('אשראי') || m.includes('card') || m.includes('credit')) return { cc: { sum: total } };
  if (m.includes('העברה') || m.includes('transfer') || m.includes('bank')) return { banktransfer: { sum: total } };
  if (m.includes('צ') || m.includes('cheque') || m.includes('check')) return { cheques: [{ sum: total }] };
  return { cash: { sum: total } };
}

/** doc/create returns only docnum + doc_url; doc/info has doc_id + allocation. */
async function docInfo(c: IcountCreds, doctype: string, docnum: string) {
  const data = await call(c, 'doc/info', { doctype, docnum });
  const d = data.doc_info ?? {};
  return {
    docId: d.doc_id ? String(d.doc_id) : null,
    allocationNumber: d.invoice_reference_number ? String(d.invoice_reference_number) : null,
    issueDate: d.issue_date || d.dateissued || null,
  };
}

export const icountAdapter: InvoiceProvider = {
  async issue(input: IssueInput): Promise<IssuedDoc> {
    const c = readCreds(input.credentials);
    const doctype = DOCTYPE[input.docType];
    const data = await call(c, 'doc/create', {
      doctype,
      client_name: input.customer.name,
      client_idno: input.customer.idNo || undefined,
      client_address: input.customer.address || undefined,
      lang: 'he',
      currency: 'ILS',
      items: input.items,
      /* A payment block only on the document that IS a payment. An invrec is
         rejected without one; a plain invoice describes money not yet received,
         and claiming it was paid is the one thing that would make the document
         a lie. */
      ...(input.docType === 'invoice_receipt' ? paymentBlock(input.payMethod, input.total) : {}),
      email_to_client: false,
      send_email: false,
    });
    const docnum = String(data.docnum);
    const info = await docInfo(c, doctype, docnum).catch(() => null);
    return { docnum, docId: info?.docId ?? null, pdfUrl: data.doc_url ?? null, allocationNumber: info?.allocationNumber ?? null, issueDate: info?.issueDate ?? null };
  },

  // A receipt has no lines: it says money arrived, and names the invoice it
  // arrived against. The payment block is the whole content of the document.
  async collect(input: CollectInput): Promise<IssuedDoc> {
    const c = readCreds(input.credentials);
    const data = await call(c, 'doc/create', {
      doctype: DOCTYPE.receipt,
      client_name: input.customer.name,
      client_idno: input.customer.idNo || undefined,
      lang: 'he',
      currency: 'ILS',
      ...paymentBlock(input.payMethod, input.amount),
      based_on: [{ doctype: DOCTYPE.tax_invoice, docnum: input.basedOnDocnum }],
      email_to_client: false,
      send_email: false,
    });
    const docnum = String(data.docnum);
    const info = await docInfo(c, DOCTYPE.receipt, docnum).catch(() => null);
    return { docnum, docId: info?.docId ?? null, pdfUrl: data.doc_url ?? null, allocationNumber: info?.allocationNumber ?? null, issueDate: info?.issueDate ?? null };
  },

  async cancel(input: CancelInput): Promise<IssuedDoc> {
    const c = readCreds(input.credentials);
    const data = await call(c, 'doc/create', {
      doctype: DOCTYPE.credit_note,
      client_name: input.customer.name,
      client_idno: input.customer.idNo || undefined,
      lang: 'he',
      currency: 'ILS',
      items: input.items,
      refundreason: input.reason,
      based_on: [{ doctype: DOCTYPE.invoice_receipt, docnum: input.basedOnDocnum }],
    });
    const docnum = String(data.docnum);
    const info = await docInfo(c, DOCTYPE.credit_note, docnum).catch(() => null);
    return { docnum, docId: info?.docId ?? null, pdfUrl: data.doc_url ?? null, allocationNumber: info?.allocationNumber ?? null, issueDate: info?.issueDate ?? null };
  },

  // ---- expenses ----
  // iCount needs three things an expense references to exist first: the supplier,
  // an expense type (category), and a document number. Resolve/create the first
  // two, then create the expense. Returns both provider ids to store back.
  async recordExpense(input: RecordExpenseInput): Promise<RecordedExpense> {
    const c = readCreds(input.credentials);

    // 1) supplier — reuse if we already synced one; else match an existing iCount
    //    supplier by vat_id (iCount enforces it unique, so a blind add would fail
    //    for a supplier created earlier or outside our app); else create.
    let supplierId = input.supplier.providerSupplierId ?? null;
    if (!supplierId && input.supplier.taxId) {
      supplierId = await findSupplierByVatId(c, input.supplier.taxId);
    }
    if (!supplierId) {
      const s = await call(c, 'supplier/add', {
        supplier_name: input.supplier.name,
        vat_id: input.supplier.taxId || undefined,
        email: input.supplier.email || undefined,
        phone: input.supplier.phone || undefined,
      });
      supplierId = String(s.supplier_id);
    }

    // 2) expense type — match the category by name, or create it. Default the
    //    category to "כללי" (general) when the expense has none.
    const typeName = (input.category && input.category.trim()) || 'כללי';
    const typeId = await resolveExpenseType(c, typeName);

    // 3) the expense itself. docnum is required by iCount.
    //    IMPORTANT: iCount's expense_sum is the GROSS total (VAT-inclusive), and
    //    it derives VAT from it. So send subtotal+vat, and pin the exact VAT with
    //    expense_manual_vat so our figure is used verbatim rather than re-derived.
    //    (VAT-free expenses (vat 0) are an iCount type-level setting we don't set
    //    yet — the native record stays correct; see docs/PRODUCTION.md §4c.)
    const gross = Math.round((input.subtotal + input.vat) * 100) / 100;
    const exp = await call(c, 'expense/create', {
      supplier_id: supplierId,
      expense_type_id: typeId,
      expense_sum: gross,
      expense_manual_vat: 1,
      expense_vat: input.vat,
      expense_date: input.date,
      expense_docnum: input.docnum,
      expense_description: input.description || undefined,
    });

    return { providerSupplierId: supplierId, providerExpenseId: String(exp.expense_id) };
  },
};

/** Match an existing iCount supplier by vat_id, or null. iCount enforces vat_id
 *  unique per account, so a supplier already there must be reused, not re-added. */
interface IcountSupplier {
  supplier_id: number | string;
  vat_id?: string;
}

async function findSupplierByVatId(c: IcountCreds, vatId: string): Promise<string | null> {
  const list = await call(c, 'supplier/get_list', {});

  /* iCount hands this back as a list on some accounts and as an object keyed by
     supplier id on others, so it is typed as the union it actually is. It used
     to be cast to an array and THEN checked with Array.isArray — which left the
     non-array branch narrowed to `never`, Object.values() unable to infer an
     element type from it, and every field access on the loop variable an error.
     The runtime behaviour was right all along; the cast was describing only
     half of what the API returns. */
  const raw = (list.suppliers ?? []) as IcountSupplier[] | Record<string, IcountSupplier>;
  const suppliers: IcountSupplier[] = Array.isArray(raw) ? raw : Object.values(raw);

  for (const s of suppliers) {
    if (s.vat_id && String(s.vat_id) === String(vatId)) return String(s.supplier_id);
  }
  return null;
}

/** Find an expense type by name, creating it if the account has none matching.
 *  iCount rejects expense/create without a valid expense_type_id. */
async function resolveExpenseType(c: IcountCreds, name: string): Promise<string> {
  const list = await call(c, 'expense/types', {});
  const types = (list.expense_types ?? {}) as Record<string, { expense_type_id: number; expense_type_name: string }>;
  for (const t of Object.values(types)) {
    if (t.expense_type_name === name) return String(t.expense_type_id);
  }
  const added = await call(c, 'expense_type/add', { expense_type_name: name });
  return String(added.expense_type_id);
}
