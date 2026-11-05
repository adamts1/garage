/* הנחת מע״מ on a ticket's lines.

   A flagged line keeps the price it shows and the customer pays exactly that
   for it: VAT still goes on at the end, onto the price that comes back to it.
   What is pinned here is that every place that prices a ticket — the summary,
   the printed sheet, the message, the invoice regrouping — agrees on it.
   issue-invoice repeats the arithmetic in Deno (chargedUnit). */

import { describe, expect, it } from 'vitest';
import {
  laborCharged, netFromGross, partUnitCharged, worksCharged, worksSummary, worksVatDiscount,
  type TicketWork,
} from './catalog';
import { groupInvoiceLines, type InvoiceLine } from './invoices';
import { workOrderHtml } from './printDoc';
import type { Ticket } from './types';
import { waMessage } from './waMessage';

const oil: TicketWork = {
  uid: 'w1', code: 'OIL', name: 'טיפול', labor: 350, laborVatDiscount: true,
  items: [{ sku: 'F-1', name: 'מסנן שמן', qty: 1, price: 150, vatDiscount: true }],
};

describe('netFromGross', () => {
  it('finds the pre-VAT price that comes back to the figure', () => {
    expect(netFromGross(500)).toBe(423.73);
    expect(netFromGross(117, 0.17)).toBe(100);
  });

  /* One agora before VAT is 1.18 after it, so some figures fall between two
     pre-VAT prices. The nearest is then an agora away, never more. */
  it('is never more than an agora off', () => {
    expect(Math.round(netFromGross(2) * 1.18 * 100) / 100).toBe(1.99);
    for (let agorot = 1; agorot <= 20_000; agorot++) {
      const gross = agorot / 100;
      const back = Math.round(netFromGross(gross) * 1.18 * 100) / 100;
      expect(Math.abs(back - gross)).toBeLessThanOrEqual(0.01 + 1e-9);
    }
  });

  it('is zero for nothing, a negative or nonsense', () => {
    expect(netFromGross(0)).toBe(0);
    expect(netFromGross(-5)).toBe(0);
    expect(netFromGross(Number.NaN)).toBe(0);
  });
});

describe('the arithmetic', () => {
  it('a flagged line keeps its price and is charged the pre-VAT one', () => {
    expect(laborCharged(oil)).toBe(296.61);
    expect(partUnitCharged(oil.items[0])).toBe(127.12);
  });

  it('an unflagged line is charged what it shows', () => {
    expect(laborCharged({ ...oil, laborVatDiscount: undefined })).toBe(350);
  });

  it('comes after the percent discount, per unit', () => {
    const part = { sku: 'P', name: 'p', qty: 2, price: 100, discount: 10, vatDiscount: true };
    // 100 less 10% is 90 shown; 90 with VAT in it is 76.27 before VAT.
    expect(partUnitCharged(part)).toBe(76.27);
    expect(worksCharged([{ ...oil, labor: 0, laborVatDiscount: undefined, items: [part] }])).toBeCloseTo(152.54, 10);
  });

  it('the customer pays what the lines show', () => {
    const sum = worksSummary([oil]);
    expect(sum.labor + sum.parts).toBe(500);
    expect(sum.vatDiscount).toBe(76.27);
    expect(sum.net).toBe(423.73);
    expect(sum.vat).toBe(76.27);
    expect(sum.total).toBe(500);
  });

  it('mixed with an ordinary line, only the flagged one is discounted', () => {
    const plain: TicketWork = { uid: 'w2', code: 'X', name: 'ניקוי', labor: 100, items: [] };
    const sum = worksSummary([oil, plain]);
    expect(sum.net).toBe(523.73);
    expect(sum.total).toBe(618);
    expect(worksVatDiscount([plain])).toBe(0);
  });
});

describe('the printed sheet', () => {
  const ticket = {
    k: 'GAR-12', st: 'done', type: 'job', epic: 'service', prio: 'high', pts: 3,
    who: 'dk', job: 'W-4', title: 'טיפול', plate: '12-345-67', car: 'מאזדה 3',
    customer: 'יוסי לוי', amount: 0, done: 0, subtasks: [], due: '-', flags: [],
    works: [oil],
  } as Ticket;
  const html = workOrderHtml(ticket, { labour: 350, items: 150, vat: 76.27, total: 500 });

  it('keeps the line price and names the VAT discount on it', () => {
    expect(html).toContain('350.00');
    expect(html).toContain('<div class="disc">הנחת מע״מ</div>');
  });

  it('takes it off in the totals, before VAT', () => {
    expect(html).toContain('-₪76.27');
    expect(html).toContain('סה״כ לפני מע״מ');
    expect(html).toContain('423.73');
  });

  it('prints no VAT discount row on a ticket without one', () => {
    const plain = workOrderHtml(
      { ...ticket, works: [{ ...oil, laborVatDiscount: undefined, items: [] }] },
      { labour: 350, items: 0, vat: 63, total: 413 },
    );
    expect(plain).not.toContain('הנחת מע״מ');
  });
});

describe('the WhatsApp message', () => {
  it('lists the lines as shown and the discount before VAT', () => {
    const msg = waMessage({
      ticket: { customer: 'יוסי', car: 'מאזדה', plate: '1', title: '', paid: false, works: [oil] },
      closed: false,
      total: 0,
    });
    expect(msg).toContain('(הנחת מע״מ)');
    expect(msg).toContain('הנחת מע״מ: -₪76.27');
    expect(msg).toContain('סה״כ לפני מע״מ: ₪423.73');
    expect(msg).toContain('סה״כ לתשלום: ₪500.00');
  });
});

describe('regrouping an invoice issued with a VAT discount', () => {
  const line = (desc: string, unit: number): InvoiceLine =>
    ({ desc, qty: 1, unit_price: unit, line_total: unit });

  it('matches the pre-VAT prices issue-invoice bills', () => {
    const groups = groupInvoiceLines(
      { lines: [line('טיפול', 296.61), line('מסנן שמן', 127.12)] },
      [oil],
    );
    expect(groups?.[0].labour?.unit_price).toBe(296.61);
    expect(groups?.[0].parts).toHaveLength(1);
  });
});
