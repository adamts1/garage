import type { Invoice } from '@garage/shared';
import { describe, expect, it } from 'vitest';
import { presetRange, summarise, type DateRange } from './incomeRollUp';

const doc = (over: Partial<Invoice>): Invoice => ({
  id: Math.random().toString(36).slice(2),
  ticketId: null, ticketKey: null,
  docType: 'invoice_receipt',
  provider: 'icount', docnum: '1', allocationNumber: null, pdfUrl: null,
  issuedAt: '2026-08-05T10:00:00.000Z',
  customerName: null, customerIdNumber: null, customerAddress: null, customerPhone: null,
  lines: [], subtotal: 100, vatRate: 0.18, vat: 18, total: 118,
  payMethod: null, payReference: null,
  status: 'issued', cancelledBy: null, creditsInvoiceId: null, paysInvoiceId: null,
  createdAt: '2026-08-05T10:00:00.000Z',
  ...over,
});

const ALL: DateRange = { from: '', to: '' };

describe('summarise', () => {
  it('counts a bill as money billed', () => {
    expect(summarise([doc({})], ALL).billed).toBe(118);
  });

  it('takes a credit note back off', () => {
    const billed = summarise([
      doc({}),
      doc({ docType: 'credit_note', subtotal: 50, vat: 9, total: 59 }),
    ], ALL).billed;
    expect(billed).toBe(59);
  });

  /* The one that catches people. A receipt is income already counted, arriving
     — the חשבונית מס booked the sale. Adding both counts the same work twice,
     and a month where everybody paid would read as double what was earned. */
  it('does not count a receipt as income', () => {
    const summary = summarise([
      doc({ docType: 'tax_invoice' }),
      doc({ docType: 'receipt', subtotal: 118, vat: 0, total: 118 }),
    ], ALL);

    expect(summary.billed).toBe(118);
    expect(summary.collected).toBe(118);
  });

  it('reports what came in beside what was billed, never inside it', () => {
    const summary = summarise([doc({ docType: 'receipt', total: 500 })], ALL);
    expect(summary.billed).toBe(0);
    expect(summary.collected).toBe(500);
  });

  it('leaves cancelled documents out entirely', () => {
    // The invoice and the note that killed it cancel out; counting the reversal
    // as well would subtract it twice.
    const summary = summarise([
      doc({ status: 'cancelled' }),
      doc({ docType: 'credit_note', status: 'cancelled', total: 118 }),
    ], ALL);
    expect(summary.billed).toBe(0);
    expect(summary.lines).toEqual([]);
  });

  it('nets VAT the same way it nets the gross', () => {
    const summary = summarise([
      doc({}),
      doc({ docType: 'credit_note', subtotal: 100, vat: 18, total: 118 }),
    ], ALL);
    expect(summary.billedNet).toBe(0);
    expect(summary.billedVat).toBe(0);
  });

  it('gives a line per document type, and drops the types with nothing in them', () => {
    const summary = summarise([doc({}), doc({})], ALL);
    expect(summary.lines).toHaveLength(1);
    expect(summary.lines[0]).toMatchObject({ docType: 'invoice_receipt', count: 2, gross: 236 });
  });

  describe('over a date range', () => {
    const july = doc({ issuedAt: '2026-07-31T21:00:00.000Z' });
    const august = doc({ issuedAt: '2026-08-01T05:00:00.000Z' });

    it('keeps both ends inclusive', () => {
      expect(summarise([july, august], { from: '2026-07-31', to: '2026-08-01' }).lines[0].count).toBe(2);
    });

    it('excludes what falls outside', () => {
      expect(summarise([july, august], { from: '2026-08-01', to: '' }).lines[0].count).toBe(1);
    });

    /* Compared as YYYY-MM-DD, not as instants: a document issued late in the
       evening must not land in tomorrow because the browser is ahead of the
       garage. */
    it('places a document by its own date, not by the reader’s clock', () => {
      expect(summarise([july], { from: '2026-07-31', to: '2026-07-31' }).lines).toHaveLength(1);
    });
  });
});

describe('presetRange', () => {
  const day = new Date(2026, 7, 9); // 9 August 2026

  it('runs this month from the first to the last', () => {
    expect(presetRange('thisMonth', day)).toEqual({ from: '2026-08-01', to: '2026-08-31' });
  });

  it('handles last month across a shorter one', () => {
    expect(presetRange('lastMonth', day)).toEqual({ from: '2026-07-01', to: '2026-07-31' });
  });

  /* Two months at a time, aligned to the pairs a business reports VAT in — the
     report exists to be copied onto that form. August is the second month of
     July–August, so the period starts in July. */
  it('gives the two-month VAT period the day falls in', () => {
    expect(presetRange('thisVatPeriod', day)).toEqual({ from: '2026-07-01', to: '2026-08-31' });
  });

  it('gives the whole year', () => {
    expect(presetRange('thisYear', day)).toEqual({ from: '2026-01-01', to: '2026-12-31' });
  });

  it('leaves both ends open for everything', () => {
    expect(presetRange('all', day)).toEqual({ from: '', to: '' });
  });
});
