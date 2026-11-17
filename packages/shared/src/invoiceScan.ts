/* Scanned supplier invoices — from what the model read to what a person saves.

   extract-invoice returns the document as printed (InvoiceExtraction). This
   turns it into a draft of a supplier expense, in this system's terms — prices
   before VAT, one VAT rate — and says what on it deserves a second look. Both
   apps' review screens use it, and re-run the checks on every edit.

   What gets highlighted is decided by evidence, not by the model's opinion of
   itself: a field it left blank, a line whose quantity × price is not the line
   total it printed, lines that do not add up to the invoice's totals, VAT that
   is not the rate, a tax id whose check digit is wrong. */

import { VAT, finalNet, netFromGross, spreadToNet } from './catalog';
import type { ExpenseLine } from './expenses';
import { getClient } from './client';
import { decodeBase64 } from './db';

const round2 = (n: number) => Math.round(n * 100) / 100;

/** The shape extract-invoice returns (supabase/functions/_shared/extractInvoice.ts). */
export interface ExtractedLine {
  desc: string | null;
  qty: number | null;
  unit_price: number | null;
  line_total: number | null;
}

export interface InvoiceExtraction {
  supplier_name: string | null;
  supplier_tax_id: string | null;
  exempt_dealer: boolean;
  document_type: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  prices_include_vat: boolean | null;
  lines: ExtractedLine[];
  document_discount: number | null;
  subtotal: number | null;
  vat_amount: number | null;
  total: number | null;
  unreadable: string | null;
}

export interface SupplierMatch {
  id: string;
  name: string;
  tax_id: string | null;
  /** By name is a suggestion the person confirms; by tax id is an identification. */
  by: 'tax_id' | 'name';
}

export interface ExtractResponse {
  scan_id: string;
  extraction: InvoiceExtraction;
  supplier: SupplierMatch | null;
  duplicate_of: string | null;
  model: string;
}

/** One item on the review screen. Figures are strings — what is in the field. */
export interface ScanLine {
  desc: string;
  qty: string;
  unitPrice: string;
  /** Fields to check against the photo, as read. Cleared by the screen once
   *  the person edits that field. */
  flags: Array<'desc' | 'qty' | 'unitPrice'>;
}

export interface ScanDraft {
  supplierName: string;
  supplierTaxId: string;
  reference: string;
  /** YYYY-MM-DD, or '' when it was not read. */
  date: string;
  /** 0.18, or 0 for an invoice without VAT. */
  vatRate: number;
  /** Item prices are BEFORE VAT here, whatever the document printed. */
  lines: ScanLine[];
  /** The invoice's own figures, kept to check the lines against. */
  invoice: { subtotal: number | null; vat: number | null; total: number | null };
  /** What was done to the printed prices on the way in, for the screen to say. */
  converted: 'from_incl_vat' | null;
  /** Read off the document but not acted on: a discount on the whole
   *  document, which the screen offers to spread over the items. */
  documentDiscount: number | null;
  /** How the VAT rate was arrived at. 'unclear' gets a highlight. */
  vatBasis: 'exempt_dealer' | 'no_vat_on_document' | 'vat_on_document' | 'unclear';
}

const s = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? '' : String(n));

/** An Israeli tax id (ח.פ., ע.מ., ת.ז.) by its check digit. Up to nine
 *  digits, left-padded with zeros as the registry does. Null when there is
 *  nothing to check — blank is not invalid, it is missing. */
export function isValidIsraeliTaxId(raw: string | null | undefined): boolean | null {
  const d = (raw ?? '').replace(/\D/g, '');
  if (!d) return null;
  if (d.length > 9 || d.length < 5) return false;
  const p = d.padStart(9, '0');
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    let x = Number(p[i]) * (i % 2 === 0 ? 1 : 2);
    if (x > 9) x -= 9;
    sum += x;
  }
  return sum % 10 === 0;
}

/** The document's VAT rate: none when it says עוסק פטור or shows zero VAT, or
 *  when its total is its subtotal; the standard rate when it shows VAT. When
 *  it shows neither, the standard rate — the common case — flagged unclear. */
function vatFrom(ex: InvoiceExtraction): Pick<ScanDraft, 'vatRate' | 'vatBasis'> {
  if (ex.exempt_dealer) return { vatRate: 0, vatBasis: 'exempt_dealer' };
  if (ex.vat_amount === 0) return { vatRate: 0, vatBasis: 'no_vat_on_document' };
  if (ex.vat_amount != null && ex.vat_amount > 0) return { vatRate: VAT, vatBasis: 'vat_on_document' };
  if (ex.subtotal != null && ex.total != null && Math.abs(ex.total - ex.subtotal) < 0.005) {
    return { vatRate: 0, vatBasis: 'no_vat_on_document' };
  }
  return { vatRate: VAT, vatBasis: 'unclear' };
}

/** The pre-VAT amount the document comes to: its subtotal, else its total less
 *  VAT. Null when it printed neither. */
const documentNet = (ex: InvoiceExtraction, vatRate: number): number | null => {
  if (vatRate === 0) return ex.total ?? ex.subtotal;
  if (ex.subtotal != null) return ex.subtotal;
  if (ex.total != null && ex.vat_amount != null) return round2(ex.total - ex.vat_amount);
  if (ex.total != null) return finalNet(ex.total, vatRate);
  return null;
};

/** The review screen's starting point. */
export function draftFromExtraction(ex: InvoiceExtraction): ScanDraft {
  const { vatRate, vatBasis } = vatFrom(ex);

  // Flags from the lines as printed, before any conversion changes the figures.
  const read = (ex.lines ?? []).map((l) => {
    const flags: ScanLine['flags'] = [];
    if (!l.desc?.trim()) flags.push('desc');
    if (l.qty == null || !(l.qty > 0)) flags.push('qty');
    if (l.unit_price == null || l.unit_price < 0) flags.push('unitPrice');
    if (l.qty != null && l.unit_price != null && l.line_total != null
        && Math.abs(round2(l.qty * l.unit_price) - l.line_total) > 0.01) {
      if (!flags.includes('qty')) flags.push('qty');
      if (!flags.includes('unitPrice')) flags.push('unitPrice');
    }
    return { desc: l.desc?.trim() ?? '', qty: l.qty, unitPrice: l.unit_price, flags };
  });

  let lines: ScanLine[] = read.map((l) => ({ desc: l.desc, qty: s(l.qty), unitPrice: s(l.unitPrice), flags: l.flags }));
  let converted: ScanDraft['converted'] = null;

  /* Prices printed with VAT: bring them to pre-VAT the way a VAT-inclusive
     counter sale is — the document's net once, spread over the lines — so the
     items add up to the invoice rather than drifting by an agora a line. */
  if (ex.prices_include_vat && vatRate > 0 && read.every((l) => l.qty != null && l.unitPrice != null)) {
    const gross = read.map((l) => ({ unitprice: l.unitPrice as number, quantity: l.qty as number, desc: l.desc, flags: l.flags }));
    const target = documentNet(ex, vatRate);
    if (target != null) {
      const { lines: net } = spreadToNet(gross, target);
      lines = net.map((l) => ({ desc: l.desc, qty: s(l.quantity), unitPrice: s(l.unitprice), flags: l.flags }));
    } else {
      lines = gross.map((l) => ({ desc: l.desc, qty: s(l.quantity), unitPrice: s(netFromGross(l.unitprice, vatRate)), flags: l.flags }));
    }
    converted = 'from_incl_vat';
  }

  return {
    supplierName: ex.supplier_name?.trim() ?? '',
    supplierTaxId: ex.supplier_tax_id?.trim() ?? '',
    reference: ex.invoice_number?.trim() ?? '',
    date: /^\d{4}-\d{2}-\d{2}$/.test(ex.invoice_date ?? '') ? (ex.invoice_date as string) : '',
    vatRate,
    lines,
    invoice: { subtotal: ex.subtotal, vat: ex.vat_amount, total: ex.total },
    converted,
    documentDiscount: ex.document_discount && ex.document_discount > 0 && !converted ? ex.document_discount : null,
    vatBasis,
  };
}

/** The lines as figures. A line nobody filled in is dropped; a half-filled one
 *  makes the draft incomplete — as readyLines() does for a typed expense. */
export function scanLines(draft: ScanDraft): { lines: ExpenseLine[]; incomplete: boolean } {
  const out: ExpenseLine[] = [];
  let incomplete = false;
  for (const l of draft.lines) {
    const desc = l.desc.trim();
    if (!desc && !l.qty.trim() && !l.unitPrice.trim()) continue;
    const qty = Number(l.qty);
    const unit = Number(l.unitPrice);
    if (!desc || !l.qty.trim() || !(qty > 0) || !l.unitPrice.trim() || !(unit >= 0)) { incomplete = true; continue; }
    out.push({ desc, qty, unit_price: unit });
  }
  return { lines: out, incomplete };
}

export interface ScanChecks {
  /** Pre-VAT, as the expense will be stored. */
  linesSubtotal: number;
  /** What the lines should come to, from the document, or null if it printed no totals. */
  expected: number | null;
  /** linesSubtotal − expected, when that is more than rounding. */
  mismatch: number | null;
  /** The document's VAT is not the rate applied to its subtotal. */
  vatMismatch: boolean;
  taxIdInvalid: boolean;
  missing: Array<'supplier' | 'date' | 'lines'>;
  incomplete: boolean;
}

/** Rounding a document may carry: a shekel either way (the spec's tolerance). */
export const SCAN_SUM_TOLERANCE = 1;

export function scanChecks(draft: ScanDraft, opts: { supplierChosen: boolean }): ScanChecks {
  const { lines, incomplete } = scanLines(draft);
  const linesSubtotal = round2(lines.reduce((t, l) => t + l.qty * l.unit_price, 0));
  const inv = draft.invoice;

  let expected: number | null;
  if (draft.vatRate === 0) expected = inv.total ?? inv.subtotal;
  else if (inv.subtotal != null) expected = inv.subtotal;
  else if (inv.total != null && inv.vat != null) expected = round2(inv.total - inv.vat);
  else if (inv.total != null) expected = finalNet(inv.total, draft.vatRate);
  else expected = null;

  const diff = expected == null ? 0 : round2(linesSubtotal - expected);
  const vatMismatch = draft.vatRate > 0 && inv.subtotal != null && inv.vat != null
    && Math.abs(round2(inv.subtotal * draft.vatRate) - inv.vat) > SCAN_SUM_TOLERANCE;

  const missing: ScanChecks['missing'] = [];
  if (!opts.supplierChosen && !draft.supplierName.trim()) missing.push('supplier');
  if (!draft.date) missing.push('date');
  if (lines.length === 0) missing.push('lines');

  return {
    linesSubtotal,
    expected,
    mismatch: Math.abs(diff) > SCAN_SUM_TOLERANCE ? diff : null,
    vatMismatch,
    taxIdInvalid: isValidIsraeliTaxId(draft.supplierTaxId) === false,
    missing,
    incomplete,
  };
}

/** Spread a discount on the whole document over the items, so they add up to
 *  the document's net. The screen offers this when the lines come to more than
 *  the invoice and the invoice printed a discount. */
export function applyDocumentDiscount(draft: ScanDraft): ScanDraft {
  const { lines } = scanLines(draft);
  const target = draft.vatRate === 0 ? draft.invoice.total : draft.invoice.subtotal;
  if (target == null || lines.length === 0) return draft;
  const { lines: net } = spreadToNet(lines.map((l) => ({ unitprice: l.unit_price, quantity: l.qty, desc: l.desc })), target);
  return {
    ...draft,
    lines: net.map((l) => ({ desc: l.desc, qty: s(l.quantity), unitPrice: s(l.unitprice), flags: [] })),
    documentDiscount: null,
  };
}

/* ------------------------------------------------------------ the calls */

export const SCAN_BUCKET = 'expense-scans';
export const SCAN_MAX_PAGES = 5;

/** Where a page lives: its own name inside the scan's folder. Pages upload as
 *  they are taken, so a name is not a position — the order is the list handed
 *  to extractScan(). */
export const scanPagePath = (garageId: string, scanId: string, name: string) =>
  `${garageId}/${scanId}/${name}`;

/** A fresh page name, unique within its scan. Matches extract-invoice's
 *  PAGE_NAME and valid_scan_pages(): letters, digits and dashes, then .jpg
 *  for a photographed page or .pdf for a PDF as the supplier sent it. */
export const newScanPageName = (ext: 'jpg' | 'pdf' = 'jpg') =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}.${ext}`;

/** Whether a stored page is a PDF rather than a photographed page. */
export const isPdfPage = (name: string) => name.toLowerCase().endsWith('.pdf');

export interface ScanStart { id: string; garageId: string }

/** Start a scan — on the first page, before the rest are taken. The row comes
 *  back with the garage its pages must be uploaded under: the storage policy
 *  checks that prefix. The page count is set at סיום, by extract-invoice. */
export const startScan = async (): Promise<ScanStart> => {
  const { data, error } = await getClient()
    .from('expense_scans')
    .insert({ page_count: 1 })
    .select('id, garage_id')
    .single();
  if (error) throw error;
  return { id: data.id, garageId: data.garage_id };
};

/** Upload one page, already shrunk to a JPEG. A page that is already there
 *  counts as uploaded: that is a retry after a response that never arrived. */
export const uploadScanPage = async (scan: ScanStart, name: string, base64Jpeg: string): Promise<void> => {
  const { error } = await getClient()
    .storage.from(SCAN_BUCKET)
    .upload(scanPagePath(scan.garageId, scan.id, name), decodeBase64(base64Jpeg), {
      contentType: 'image/jpeg', upsert: false,
    });
  if (error && !/exists|duplicate/i.test(error.message)) throw error;
};

/** Upload one file as it is — the browser's path: a JPEG it has already
 *  shrunk, or a PDF. A file already there counts as uploaded (a retry). */
export const uploadScanFile = async (
  scan: ScanStart,
  name: string,
  data: Blob | ArrayBuffer | Uint8Array,
): Promise<void> => {
  const { error } = await getClient()
    .storage.from(SCAN_BUCKET)
    .upload(scanPagePath(scan.garageId, scan.id, name), data, {
      contentType: isPdfPage(name) ? 'application/pdf' : 'image/jpeg', upsert: false,
    });
  if (error && !/exists|duplicate/i.test(error.message)) throw error;
};

/** A failed reading, with whether trying again might help. */
export class ScanExtractError extends Error {
  constructor(message: string, readonly retryable: boolean, readonly code?: string) {
    super(message);
  }
}

/** Ask extract-invoice to read the scan's pages, in this order. Answers from
 *  the stored result when the same pages were already read, so a retry costs
 *  nothing. */
export const extractScan = async (scanId: string, pages: readonly string[]): Promise<ExtractResponse> => {
  const { data, error } = await getClient().functions.invoke('extract-invoice', {
    body: { scan_id: scanId, pages },
  });
  if (error) {
    let body: any = null;
    try { body = await (error as any)?.context?.json?.(); } catch { /* not JSON */ }
    const status: number | undefined = (error as any)?.context?.status;
    throw new ScanExtractError(
      body?.error ?? (error as Error).message ?? 'the request failed',
      body?.retryable ?? (status == null || status >= 500),
      body?.code,
    );
  }
  return data as ExtractResponse;
};

/** The supplier's invoice number is already on file for that supplier. */
export class DuplicateInvoiceError extends Error {
  constructor(readonly existingExpenseId: string | null) {
    super('duplicate invoice');
  }
}

export interface SaveScanInput {
  scanId: string;
  /** An existing supplier, or null to use / create the one named below. */
  supplierId: string | null;
  supplierName: string;
  supplierTaxId: string;
  draft: ScanDraft;
  paid: boolean;
  dueDate?: string | null;
  chequeNumber?: string | null;
  chequeDate?: string | null;
  /** The person saw the duplicate warning and saves anyway. */
  allowDuplicate?: boolean;
  category?: string | null;
  description?: string | null;
  /** The document's files in order. Needed when nobody read it (attached on
   *  the form, or reviewed by hand); a scan that was read already has them. */
  pages?: readonly string[] | null;
}

/** Save the reviewed scan as one supplier expense (save_scanned_expense). */
export const saveScannedExpense = async (input: SaveScanInput): Promise<string> => {
  const { lines } = scanLines(input.draft);
  const { data, error } = await getClient().rpc('save_scanned_expense', {
    p_scan_id: input.scanId,
    p_supplier_id: input.supplierId,
    p_supplier_name: input.supplierName,
    p_supplier_tax_id: input.supplierTaxId || null,
    p_date: input.draft.date,
    p_reference: input.draft.reference || null,
    p_lines: lines,
    p_vat_rate: input.draft.vatRate,
    p_paid: input.paid,
    p_due_date: input.dueDate || null,
    p_cheque_number: input.chequeNumber || null,
    p_cheque_date: input.chequeDate || null,
    p_allow_duplicate: input.allowDuplicate ?? false,
    p_category: input.category || null,
    p_description: input.description || null,
    p_pages: input.pages && input.pages.length > 0 ? [...input.pages] : null,
  });
  if (error) {
    if (error.code === '23505') throw new DuplicateInvoiceError(error.hint || null);
    throw error;
  }
  return data as string;
};

/** Signed URLs for a scan's pages, in order — for the review screen to show
 *  the original beside what was read. An hour: a review is minutes, and a
 *  draft re-signs when it is reopened. */
export const signScanPages = async (scan: ScanStart, pages: readonly string[]): Promise<string[]> => {
  const paths = pages.map((name) => scanPagePath(scan.garageId, scan.id, name));
  const { data, error } = await getClient().storage.from(SCAN_BUCKET).createSignedUrls(paths, 3600);
  if (error) throw error;
  return (data ?? []).map((d) => d.signedUrl ?? '');
};

/** Put a document on an expense that was saved without one. Refused when it
 *  already has one: the document an expense was entered from is not swapped. */
export const attachExpenseDocument = async (
  expenseId: string,
  scanId: string,
  pages: readonly string[],
): Promise<void> => {
  const { error } = await getClient().rpc('attach_expense_document', {
    p_expense_id: expenseId, p_scan_id: scanId, p_pages: [...pages],
  });
  if (error) throw error;
};

export interface DocumentFileLink {
  name: string;
  url: string;
  kind: 'image' | 'pdf';
}

/** An expense's document, ready to show: its files in order, each with a
 *  signed URL. Scans from before named pages read as page-1…page-n. */
export const expenseDocumentFiles = async (scanId: string): Promise<DocumentFileLink[]> => {
  const { data, error } = await getClient()
    .from('expense_scans')
    .select('id, garage_id, pages, page_count')
    .eq('id', scanId)
    .single();
  if (error) throw error;
  const names: string[] = data.pages
    ?? Array.from({ length: data.page_count }, (_, i) => `page-${i + 1}.jpg`);
  const urls = await signScanPages({ id: data.id, garageId: data.garage_id }, names);
  return names.map((name, i) => ({ name, url: urls[i] ?? '', kind: isPdfPage(name) ? 'pdf' : 'image' }));
};
