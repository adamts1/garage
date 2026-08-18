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
  year: '1998',
  km: '180000',
  vehicleCode: 'MZ3-2005',
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

  /* The one field on the intake form actually labelled "קוד". It is a column on
     tickets and was written from the day the form existed — but nothing read it
     back, so it never reached the sheet the garage looks it up on. */
  it('prints the vehicle code, and the work and part codes', () => {
    printTicket(ticket, totals);
    const html = doc();
    expect(html).toContain('קוד רכב');
    expect(html).toContain('MZ3-2005');
    expect(html).toContain('BRK-01');
    expect(html).toContain('P-1');
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

  /* The name in the sidebar is short because a rail is narrow; the name on a
     document a customer keeps is usually the registered one. */
  it('prints the garage\'s print name in place of the name the app shows', () => {
    setCurrentGarage({
      id: 'g1', name: 'אי-תן', role: 'admin',
      letterhead: { printName: 'אי-תן שירותי רכב בע"מ' },
    });
    printTicket(ticket, totals);
    expect(doc()).toContain('אי-תן שירותי רכב בע&quot;מ');
  });

  it('falls back to the app name when no print name is set', () => {
    setCurrentGarage({ id: 'g1', name: 'מוסך הרצל', role: 'admin' });
    printTicket(ticket, totals);
    expect(doc()).toContain('מוסך הרצל');
  });

  /* The motto is the first thing on the sheet, above the letterhead frame. */
  it('opens the sheet with the motto, before the letterhead box', () => {
    setCurrentGarage({
      id: 'g1', name: 'מוסך הרצל', role: 'admin',
      letterhead: { motto: 'ישראל חי' },
    });
    printTicket(ticket, totals);
    const html = doc();
    expect(html).toContain('<div class="topmotto">ישראל חי</div>');
    expect(html.indexOf('topmotto')).toBeLessThan(html.indexOf('<div class="lh">'));
  });

  it('is headed by the signed-in garage, not a name compiled into the app', () => {
    setCurrentGarage({ id: 'g1', name: 'מוסך הרצל', role: 'admin' });
    printTicket(ticket, totals);
    expect(doc()).toContain('מוסך הרצל');
    expect(doc()).not.toContain('מוסך אי-תן');
  });

  /* The letterhead is per-garage and comes from that garage's own row. A
     customer holding this has to be able to reach whoever issued it. */
  it('prints the signed-in garage\'s own letterhead', () => {
    setCurrentGarage({
      id: 'g1', name: 'מוסך הרצל', role: 'admin',
      letterhead: {
        motto: 'ישראל חי',
        services: 'מכונאות לכל סוגי הרכב',
        address: 'רח׳ בית הדפוס, ירושלים',
        phone: '02-6522306', fax: '02-6522307', licenseNo: '40677',
        taxId: '514123456',
      },
    });
    printTicket(ticket, totals);
    const html = doc();
    expect(html).toContain('ישראל חי');
    expect(html).toContain('ע.מ / ח.פ.');
    expect(html).toContain('514123456');
    expect(html).toContain('מכונאות לכל סוגי הרכב');
    expect(html).toContain('רח׳ בית הדפוס, ירושלים');
    expect(html).toContain('02-6522306');
    expect(html).toContain('02-6522307');
    expect(html).toContain('מורשה משרד התחבורה');
    expect(html).toContain('40677');
  });

  /* Which is every garage until somebody fills one in. A blank line, a stray
     separator or a placeholder address would all be worse than the header this
     printed before letterheads existed — the name, and nothing else. */
  it('prints just the name for a garage with no letterhead', () => {
    setCurrentGarage({ id: 'g1', name: 'מוסך הרצל', role: 'admin' });
    printTicket(ticket, totals);
    const html = doc();
    expect(html).toContain('מוסך הרצל');
    expect(html).not.toContain('מורשה משרד התחבורה');
    expect(html).not.toContain('טלפון ');
    expect(html).not.toContain('<div class="lh-contact">');
  });

  /* A garage that gave a phone and no fax must not get "פקס" with nothing
     after it, and the separator between the two must go with the missing one. */
  it('leaves out the letterhead lines a garage has not filled in', () => {
    setCurrentGarage({
      id: 'g1', name: 'מוסך הרצל', role: 'admin',
      letterhead: { phone: '02-6522306' },
    });
    const html = (printTicket(ticket, totals), doc());
    expect(html).toContain('טלפון 02-6522306');
    expect(html).not.toContain('פקס');
    expect(html).not.toContain('מורשה משרד התחבורה');
    expect(html).not.toContain('ע.מ / ח.פ.');
  });

  it('escapes a letterhead too — it is typed by a person like everything else', () => {
    setCurrentGarage({
      id: 'g1', name: 'מוסך הרצל', role: 'admin',
      letterhead: { address: '<img src=x onerror=alert(1)>' },
    });
    printTicket(ticket, totals);
    expect(doc()).not.toContain('<img');
    expect(doc()).toContain('&lt;img');
  });

  /* The sheet carries a <script> of its own now — the one that shrinks it to a
     single page — so the assertion is about the customer's markup specifically,
     not about the string '<script>' appearing anywhere in the document. */
  it('escapes anything the customer typed', () => {
    printTicket({ ...ticket, customer: '<script>alert(1)</script>' }, totals);
    expect(doc()).not.toContain('<script>alert');
    expect(doc()).toContain('&lt;script&gt;');
  });

  it('prints each work with its parts and its own note under it', () => {
    printTicket(
      { ...ticket, works: [{ ...ticket.works![0], notes: 'הדיסקים תקינים' }] },
      totals,
    );
    const html = doc();
    expect(html).toContain('החלפת רפידות');
    expect(html).toContain('הדיסקים תקינים');
    expect(html).toContain('₪500.00');        // that work's own total
  });

  /* The labour was a line among the parts, which is where it does not belong —
     it is the one charge on a work that is not a part. It sits on the work's
     own row now, under מחיר יח׳. */
  it('puts the labour on the work row rather than in the parts beneath it', () => {
    printTicket(ticket, totals);
    const html = doc();
    expect(html).not.toContain('שכר עבודה');
    expect(html).toContain('₪300.00');        // the labour, on the work's row
  });

  /* A work order is signed and filed. The subtask checkboxes were a board
     feature printed onto it. */
  it('does not print the subtask checklist', () => {
    printTicket(ticket, totals);
    const html = doc();
    expect(html).not.toContain('משימות');
    expect(html).not.toContain('פירוק');
  });

  /* The key and the date are in the header. Repeating them under the signature
     block is a footer that says nothing the top of the page has not said. */
  it('leaves the key and the print date out of the footer', () => {
    printTicket(ticket, totals);
    const html = doc();
    expect(html.split('class="sigs"')[1]).not.toContain('GAR-12');
  });

  /* Whether the sheet fits on one page cannot be asserted from here — it is
     measured in the opened window — but the code that does the measuring has
     to reach it. */
  it('carries the one-page fit into the document', () => {
    printTicket(ticket, totals);
    expect(doc()).toContain('beforeprint');
  });

  it('no longer prints the ticket status section', () => {
    printTicket(ticket, totals);
    const html = doc();
    expect(html).not.toContain('סטטוס הכרטיס');
    expect(html).not.toContain('דחיפות');
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
  payMethod: 'cash', ticketKey: 'GAR-12',
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

  /* A printed document is Hebrew whatever the counter's language is, and
     `pay_method` is a code. A חשבונית reading "אמצעי תשלום: cash" is the
     failure this is here to catch. */
  it('names the payment method in Hebrew, not as the stored code', () => {
    printInvoice({ ...invoice, payMethod: 'bank_transfer' } as Invoice);
    const html = doc();
    expect(html).toContain('העברה בנקאית');
    expect(html).not.toContain('bank_transfer');
  });
});
