/* What the garage billed, over a period it chooses.
 *
 * The arithmetic is separated from the screen for the same reason the customer
 * report's is: it is the part that can be wrong in a way nobody notices, and it
 * is the part worth testing.
 *
 * THE RULE THAT SHAPES ALL OF IT
 *
 * A credit note is stored as a POSITIVE total on a document of its own. It is a
 * second piece of paper, not a negative number on the first. So a column of
 * totals counts a refunded sale twice — the ₪1,000 bill, and the ₪1,000 note
 * that undid it, for ₪2,000 billed on work that earned nothing.
 *
 * Every figure here is therefore signed by what the document DOES: a bill adds,
 * a credit note subtracts, and a receipt does neither.
 *
 * WHY A RECEIPT IS WORTH ZERO
 *
 * It is the one that catches people. A receipt is not income — it is income
 * already counted, arriving. The חשבונית מס booked the sale; the קבלה says the
 * money turned up. Counting both is counting the same work twice, and a month
 * where every customer paid would read as double what the garage earned.
 *
 * So receipts appear in this report as their own line, because "what did we
 * bill" and "what actually came in" are different questions a garage asks — but
 * they are never added to income.
 */

import { isBill, type Invoice, type InvoiceDocType } from '@garage/shared';
import { localDay as iso } from './localDay';

export interface DateRange {
  /** YYYY-MM-DD, inclusive. Empty means unbounded on that side. */
  from: string;
  to: string;
}

/** Was this document issued inside the range? Compared as YYYY-MM-DD strings,
 *  which sort correctly and sidestep every timezone question — `issued_at` is a
 *  timestamp, and a document issued at 23:40 must not land in tomorrow because
 *  the browser is an hour ahead of the garage. */
export const inRange = (invoice: Invoice, { from, to }: DateRange): boolean => {
  const day = invoice.issuedAt.slice(0, 10);
  if (from && day < from) return false;
  if (to && day > to) return false;
  return true;
};

/** What one document contributes to money billed: a bill adds, a credit note
 *  takes away, a receipt is silent. */
export const signedTotal = (invoice: Invoice): number =>
  isBill(invoice) ? invoice.total
  : invoice.docType === 'credit_note' ? -invoice.total
  : 0;

export interface IncomeLine {
  docType: InvoiceDocType;
  count: number;
  /** Before VAT. Zero on a receipt, which prices nothing. */
  net: number;
  vat: number;
  /** Including VAT, as it appears on the document. */
  gross: number;
}

export interface IncomeSummary {
  lines: IncomeLine[];
  /** Bills less credit notes — what the garage actually billed in the period. */
  billed: number;
  billedNet: number;
  billedVat: number;
  /** Money that arrived against invoices billed at some point, this period or
   *  an earlier one. Deliberately NOT part of `billed`. */
  collected: number;
  credited: number;
}

/* The four document types, in the order a garage reads them: what was billed
   and settled, what was billed and is owed, what came in against it, and what
   went back out. */
const ORDER: InvoiceDocType[] = ['invoice_receipt', 'tax_invoice', 'receipt', 'credit_note'];

/** One line per document type, plus the totals the KPI row shows.
 *
 *  Cancelled documents are excluded outright rather than netted: a cancelled
 *  invoice has a credit note against it that already cancels it out, and
 *  dropping both is the only way the arithmetic does not count the reversal
 *  twice. What remains is the documents that still stand. */
export function summarise(invoices: readonly Invoice[], range: DateRange): IncomeSummary {
  const kept = invoices.filter((i) => i.status === 'issued' && inRange(i, range));

  const lines = ORDER.map((docType) => {
    const of = kept.filter((i) => i.docType === docType);
    return {
      docType,
      count: of.length,
      net: round2(of.reduce((s, i) => s + i.subtotal, 0)),
      vat: round2(of.reduce((s, i) => s + i.vat, 0)),
      gross: round2(of.reduce((s, i) => s + i.total, 0)),
    };
  }).filter((line) => line.count > 0);

  const sumOf = (pick: (i: Invoice) => boolean, field: (i: Invoice) => number) =>
    round2(kept.filter(pick).reduce((s, i) => s + field(i), 0));

  const credited = sumOf((i) => i.docType === 'credit_note', (i) => i.total);

  return {
    lines,
    billed: round2(kept.reduce((s, i) => s + signedTotal(i), 0)),
    billedNet: round2(
      sumOf(isBill, (i) => i.subtotal) - sumOf((i) => i.docType === 'credit_note', (i) => i.subtotal),
    ),
    billedVat: round2(
      sumOf(isBill, (i) => i.vat) - sumOf((i) => i.docType === 'credit_note', (i) => i.vat),
    ),
    collected: sumOf((i) => i.docType === 'receipt', (i) => i.total),
    credited,
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/* ---------- the ranges a garage actually asks for ---------- */

/** Named ranges, resolved against a day the caller passes in rather than read
 *  off the clock — a function that asks the clock what today is cannot be
 *  tested, and a report that changes under a test is worse than no test. */
export function presetRange(preset: string, today: Date): DateRange {
  const y = today.getFullYear();
  const m = today.getMonth();
  switch (preset) {
    case 'thisMonth':
      return { from: iso(new Date(y, m, 1)), to: iso(new Date(y, m + 1, 0)) };
    case 'lastMonth':
      return { from: iso(new Date(y, m - 1, 1)), to: iso(new Date(y, m, 0)) };
    /* Two months at a time, because that is the VAT period a small business
       reports in — the report exists to be copied onto that form. */
    case 'thisVatPeriod': {
      const start = m - (m % 2);
      return { from: iso(new Date(y, start, 1)), to: iso(new Date(y, start + 2, 0)) };
    }
    case 'thisYear':
      return { from: iso(new Date(y, 0, 1)), to: iso(new Date(y, 11, 31)) };
    default:
      return { from: '', to: '' };
  }
}
