import type { Invoice } from '@garage/shared';
import { describe, expect, it } from 'vitest';
import { headline, netTotal, signedTotal } from './invoiceTotals';

const doc = (over: Partial<Invoice>): Invoice => ({
  id: 'i1', ticketId: null, ticketKey: null,
  docType: 'invoice_receipt', provider: 'icount', docnum: '1',
  allocationNumber: null, pdfUrl: null, issuedAt: '2026-07-01T00:00:00Z',
  customerName: 'דנה', customerIdNumber: null, customerAddress: null, customerPhone: null,
  lines: [], subtotal: 100, vatRate: 0.18, vat: 18, total: 118,
  payMethod: null, payReference: null, status: 'issued',
  ...over,
} as Invoice);

describe('signedTotal', () => {
  it('counts an invoice as money in', () => {
    expect(signedTotal(doc({ total: 118 }))).toBe(118);
  });

  it('counts a credit note as money back out', () => {
    // Stored positive by issue-invoice, which copies the original's total.
    expect(signedTotal(doc({ docType: 'credit_note', total: 118 }))).toBe(-118);
  });
});

describe('netTotal', () => {
  it('nets an invoice against its own credit note to zero', () => {
    const invoice = doc({ id: 'a', total: 1000, status: 'cancelled' });
    const note = doc({ id: 'b', docType: 'credit_note', total: 1000 });
    // The bug this replaces summed these to 2000 — a ticket that earned
    // nothing, reported as twice its own value.
    expect(netTotal([invoice, note])).toBe(0);
  });

  it('adds ordinary invoices', () => {
    expect(netTotal([doc({ id: 'a', total: 100 }), doc({ id: 'b', total: 250 })])).toBe(350);
  });

  it('goes negative when only credit notes are in view', () => {
    // Filtering the table to credit notes should show what was refunded, as a
    // refund — not as revenue.
    expect(netTotal([doc({ docType: 'credit_note', total: 400 })])).toBe(-400);
  });

  it('is zero for nothing', () => {
    expect(netTotal([])).toBe(0);
  });
});

describe('headline', () => {
  const rows = [
    doc({ id: 'a', total: 1000, status: 'issued' }),
    doc({ id: 'b', total: 500, status: 'cancelled' }),
    doc({ id: 'c', docType: 'credit_note', total: 500, status: 'issued' }),
  ];

  it('bills only issued invoice-receipts', () => {
    // Not the cancelled 500, and not the credit note at all.
    expect(headline(rows).issued).toBe(1000);
  });

  it('counts receipts without counting credit notes', () => {
    expect(headline(rows).receiptCount).toBe(2);
    expect(headline(rows).issuedCount).toBe(1);
  });

  it('counts the cancelled ones', () => {
    expect(headline(rows).cancelledCount).toBe(1);
  });

  it('survives an empty ledger', () => {
    expect(headline([])).toEqual({
      issued: 0, issuedCount: 0, receiptCount: 0, cancelledCount: 0,
    });
  });
});
