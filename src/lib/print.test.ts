import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setCurrentGarage, type Invoice, type Ticket } from '@garage/shared';
import { printInvoice, printTicket } from './print';

/* These documents go to a customer, so what matters is that every figure the
   screen shows reaches the page, that nothing a customer typed can inject
   markup, and that the photos stay out. */

let written: string[] = [];

beforeEach(() => {
  written = [];
  (globalThis as any).window = {
    open: () => ({
      document: {
        write: (s: string) => written.push(s),
        close: () => {},
      },
    }),
  };
});

afterEach(() => setCurrentGarage(null));

const doc = () => written.join('');

const ticket: Ticket = {
  k: 'GAR-12', st: 'done', type: 'job', epic: 'service', prio: 'high', pts: 3,
  who: 'dk', job: 'W-4', title: 'רעש מהבלמים',
  plate: '12-345-67', car: 'מאזדה 3', customer: 'יוסי לוי',
  amount: 590, done: 1, subtasks: ['פירוק', 'החלפה'], due: '15/08/2026', flags: [],
  phone: '050-1234567',
  works: [{
    uid: 'w1', code: 'BRK-01', name: 'החלפת רפידות', labor: 300,
    items: [{ sku: 'P-1', name: 'רפידות קדמיות', qty: 2, price: 100 }],
  }],
};

const totals = { labour: 300, items: 200, vat: 90, total: 590 };

describe('printTicket', () => {
  it('carries the customer, the vehicle and every line', () => {
    printTicket(ticket, totals);
    const html = doc();
    expect(html).toContain('GAR-12');
    expect(html).toContain('יוסי לוי');
    expect(html).toContain('12-345-67');
    expect(html).toContain('החלפת רפידות');
    expect(html).toContain('רפידות קדמיות');
  });

  it('prints the totals it was handed, not ones it recomputed', () => {
    printTicket(ticket, { labour: 300, items: 200, vat: 90, total: 590 });
    const html = doc();
    expect(html).toContain('₪590.00');
    expect(html).toContain('₪90.00');
  });

  it('leaves the photos out and says how many there were', () => {
    printTicket(ticket, totals, { photoCount: 4 });
    const html = doc();
    expect(html).not.toContain('<img');
    expect(html).toContain('4 תמונות');
  });

  it('is headed by the signed-in garage, not a name compiled into the app', () => {
    setCurrentGarage({ id: 'g1', name: 'מוסך הרצל', role: 'admin' });
    printTicket(ticket, totals);
    expect(doc()).toContain('מוסך הרצל');
    expect(doc()).not.toContain('מוסך אי-תן');
  });

  it('escapes anything the customer typed', () => {
    printTicket({ ...ticket, customer: '<script>alert(1)</script>' }, totals);
    expect(doc()).not.toContain('<script>');
    expect(doc()).toContain('&lt;script&gt;');
  });

  it('shows the ticket amount, with no VAT breakdown, when there are no works', () => {
    printTicket({ ...ticket, works: [] }, { labour: 0, items: 0, vat: 0, total: 0 });
    const html = doc();
    expect(html).toContain('₪590.00');       // the ticket's own amount
    expect(html).not.toContain('סכום ביניים');
  });
});

const invoice: Invoice = {
  id: 'i1', docnum: '1042', docType: 'invoice_receipt', status: 'issued',
  customerName: 'יוסי לוי', customerIdNumber: '123456782',
  issuedAt: '2026-07-30T09:00:00.000Z', allocationNumber: 'A-77',
  payMethod: 'מזומן', ticketKey: 'GAR-12',
  subtotal: 500, vat: 90, vatRate: 0.18, total: 590,
  lines: [{ desc: 'החלפת רפידות', qty: 1, unit_price: 500, line_total: 500 }],
} as Invoice;

describe('printInvoice', () => {
  it('prints the frozen figures from the stored row', () => {
    printInvoice(invoice);
    const html = doc();
    expect(html).toContain('1042');
    expect(html).toContain('A-77');
    expect(html).toContain('₪590.00');
    expect(html).toContain('18%');
  });

  it('calls itself a copy, so it cannot pass as the issued document', () => {
    printInvoice(invoice);
    expect(doc()).toContain('עותק');
  });

  it('says so when the document was cancelled', () => {
    printInvoice({ ...invoice, status: 'cancelled' });
    expect(doc()).toContain('בוטל');
  });
});
