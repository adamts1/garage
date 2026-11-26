import type { Invoice } from '@garage/shared';
import { describe, expect, it } from 'vitest';
import { signedTotal, ticketDocuments } from './ticketDocuments';

const doc = (over: Partial<Invoice>): Invoice => ({
  id: 'x', ticketId: 't', ticketKey: 'GAR-1', docType: 'invoice_receipt', provider: 'icount',
  docnum: '1', allocationNumber: null, pdfUrl: null, issuedAt: '2026-11-01T10:00:00Z',
  customerName: null, customerIdNumber: null, customerAddress: null, customerPhone: null,
  lines: [], subtotal: 0, vatRate: 18, vat: 0, total: 1000, payMethod: null, payReference: null,
  payments: null, vehicle: null, status: 'issued', cancelledBy: null, creditsInvoiceId: null,
  paysInvoiceId: null, createdAt: '2026-11-01T10:00:00Z', ...over,
});
const now = new Date('2026-11-05T12:00:00Z');

describe('ticketDocuments', () => {
  it('one document: it is the primary and nothing is listed', () => {
    const bill = doc({ id: 'a' });
    expect(ticketDocuments([bill], bill, now)).toEqual({ primary: bill, others: [] });
  });

  it('partial credit: the bill stays primary, the credit note is listed as new', () => {
    const bill = doc({ id: 'a' });
    const note = doc({ id: 'n', docType: 'credit_note', total: 500, creditsInvoiceId: 'a', issuedAt: '2026-11-04T10:00:00Z' });
    const r = ticketDocuments([note, bill], bill, now);
    expect(r.primary).toBe(bill);
    expect(r.others).toEqual([{ doc: note, isNew: true }]);
  });

  it('the new flag fades after a week', () => {
    const bill = doc({ id: 'a' });
    const note = doc({ id: 'n', docType: 'credit_note', creditsInvoiceId: 'a', issuedAt: '2026-10-20T10:00:00Z' });
    expect(ticketDocuments([note, bill], bill, now).others[0].isNew).toBe(false);
  });

  it('tax invoice then receipt: the invoice is primary, the receipt listed', () => {
    const bill = doc({ id: 'a', docType: 'tax_invoice' });
    const rcpt = doc({ id: 'r', docType: 'receipt', paysInvoiceId: 'a', issuedAt: '2026-11-03T10:00:00Z' });
    const r = ticketDocuments([rcpt, bill], bill, now);
    expect(r.primary).toBe(bill);
    expect(r.others.map((o) => o.doc.id)).toEqual(['r']);
  });

  it('full credit, not re-issued: the cancelling credit note becomes primary', () => {
    const bill = doc({ id: 'a', status: 'cancelled', cancelledBy: 'n' });
    const note = doc({ id: 'n', docType: 'credit_note', creditsInvoiceId: 'a', issuedAt: '2026-11-04T10:00:00Z' });
    const r = ticketDocuments([note, bill], bill, now);
    expect(r.primary).toBe(note);
    expect(r.others).toEqual([{ doc: bill, isNew: false }]);
  });

  it('full credit then re-issue: the new bill is primary, history newest first', () => {
    const old = doc({ id: 'a', status: 'cancelled', cancelledBy: 'n', issuedAt: '2026-11-01T10:00:00Z' });
    const note = doc({ id: 'n', docType: 'credit_note', creditsInvoiceId: 'a', issuedAt: '2026-11-02T10:00:00Z' });
    const fresh = doc({ id: 'b', issuedAt: '2026-11-03T10:00:00Z' });
    const r = ticketDocuments([old, note, fresh], fresh, now);
    expect(r.primary).toBe(fresh);
    expect(r.others.map((o) => [o.doc.id, o.isNew])).toEqual([['n', false], ['a', false]]);
  });

  it('a credit note counts below zero', () => {
    expect(signedTotal(doc({ docType: 'credit_note', total: 500 }))).toBe(-500);
    expect(signedTotal(doc({ total: 500 }))).toBe(500);
  });
});
