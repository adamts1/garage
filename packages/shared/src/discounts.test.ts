/* Percent discounts on a ticket's lines.

   The arithmetic is shared by the screens, the printed sheet, the WhatsApp
   message and the invoice regrouping; issue-invoice repeats it in Deno
   (netUnit). What is pinned here is the rule they all have to agree on: the
   discounted UNIT price is rounded to the agora, and a line is that times the
   quantity. */

import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  clampDiscount, discounted, laborNet, partLineTotal, partUnitNet, partsTotal, workTotal,
  worksDiscount, worksSummary, type TicketWork,
} from './catalog';
import { setSupabaseClient } from './client';
import { createTicket } from './db';
import { groupInvoiceLines, type Invoice, type InvoiceLine } from './invoices';
import { workOrderHtml } from './printDoc';
import type { Ticket } from './types';
import { waMessage } from './waMessage';

const work: TicketWork = {
  uid: 'w1', code: 'BRK-01', name: 'החלפת רפידות', labor: 300, laborDiscount: 10,
  items: [
    { sku: 'P-1', name: 'רפידות קדמיות', qty: 3, price: 33.33, discount: 15 },
    { sku: 'P-2', name: 'נוזל בלמים', qty: 1, price: 45 },
  ],
};

describe('clampDiscount', () => {
  it('keeps 0–100 as typed', () => {
    expect(clampDiscount(12.5)).toBe(12.5);
    expect(clampDiscount('20')).toBe(20);
  });

  it('caps at 100 and reads blank, negative or nonsense as none', () => {
    expect(clampDiscount(140)).toBe(100);
    expect(clampDiscount(-5)).toBe(0);
    expect(clampDiscount('')).toBe(0);
    expect(clampDiscount('abc')).toBe(0);
    expect(clampDiscount(undefined)).toBe(0);
  });
});

describe('the arithmetic', () => {
  it('rounds the discounted unit price to the agora', () => {
    // 33.33 × 0.85 = 28.3305
    expect(discounted(33.33, 15)).toBe(28.33);
    expect(partUnitNet(work.items[0])).toBe(28.33);
  });

  it('multiplies the rounded unit by the quantity, not the other way round', () => {
    expect(partLineTotal(work.items[0])).toBeCloseTo(84.99, 10);
  });

  it('leaves a line without a discount untouched', () => {
    expect(discounted(45)).toBe(45);
    expect(partLineTotal(work.items[1])).toBe(45);
  });

  it('takes the labour discount off the labour', () => {
    expect(laborNet(work)).toBe(270);
  });

  it('totals a work after every discount on it', () => {
    expect(partsTotal(work)).toBeCloseTo(129.99, 10);
    expect(workTotal(work)).toBeCloseTo(399.99, 10);
  });

  it('says how much the discounts took off', () => {
    // labour 30, parts 3 × (33.33 − 28.33) = 15
    expect(worksDiscount([work])).toBeCloseTo(45, 10);
  });

  it('a 100% discount makes the line free', () => {
    expect(laborNet({ ...work, laborDiscount: 100 })).toBe(0);
  });

  it('the summary is after discounts and carries the discount', () => {
    const sum = worksSummary([work]);
    expect(sum.labor).toBe(270);
    expect(sum.parts).toBeCloseTo(129.99, 10);
    expect(sum.discount).toBeCloseTo(45, 10);
  });

  it('a ticket with no discounts sums exactly as it did', () => {
    const plain: TicketWork = { ...work, laborDiscount: undefined, items: work.items.map(({ discount: _d, ...i }) => i) };
    const sum = worksSummary([plain]);
    expect(sum.net).toBeCloseTo(300 + 99.99 + 45, 10);
    expect(sum.discount).toBe(0);
  });
});

describe('the printed work order', () => {
  const ticket = {
    k: 'GAR-12', st: 'done', type: 'job', epic: 'service', prio: 'high', pts: 3,
    who: 'dk', job: 'W-4', title: 'בלמים', plate: '12-345-67', car: 'מאזדה 3',
    customer: 'יוסי לוי', amount: 0, done: 0, subtasks: [], due: '-', flags: [],
    works: [work],
  } as Ticket;
  const html = workOrderHtml(ticket, { labour: 270, items: 129.99, vat: 72, total: 471.99, discount: 45 } as never);

  it('names each line\'s percentage', () => {
    expect(html).toContain('הנחה 10%');
    expect(html).toContain('הנחה 15%');
  });

  it('prints the line total after the discount', () => {
    expect(html).toContain('84.99');
  });

  it('says how much the discounts came to', () => {
    expect(html).toContain('מזה הנחה');
    expect(html).toContain('45.00');
  });

  it('prints no discount row on a ticket without one', () => {
    const plain = workOrderHtml(
      { ...ticket, works: [{ ...work, laborDiscount: undefined, items: [work.items[1]] }] },
      { labour: 300, items: 45, vat: 62.1, total: 407.1 },
    );
    expect(plain).not.toContain('מזה הנחה');
    expect(plain).not.toContain('class="disc"');
  });
});

describe('the WhatsApp message', () => {
  it('prices the lines after the discount and names it', () => {
    const msg = waMessage({
      ticket: { customer: 'יוסי', car: 'מאזדה', plate: '1', title: '', paid: false, works: [work] },
      closed: false,
      total: 0,
    });
    expect(msg).toContain('עבודה: ₪270.00 (הנחה 10%)');
    expect(msg).toContain('(הנחה 15%)');
    expect(msg).toContain('₪84.99');
  });
});

describe('regrouping an invoice issued with discounts', () => {
  /* What issue-invoice emits for `work`: net unit prices, nothing else. */
  const line = (desc: string, qty: number, unit: number): InvoiceLine =>
    ({ desc, qty, unit_price: unit, line_total: qty * unit });
  const inv = {
    lines: [
      line('החלפת רפידות', 1, 270),
      line('רפידות קדמיות', 3, 28.33),
      line('נוזל בלמים', 1, 45),
    ],
  } as Pick<Invoice, 'lines'>;

  it('matches the works line for line', () => {
    const groups = groupInvoiceLines(inv, [work]);
    expect(groups).not.toBeNull();
    expect(groups![0].parts).toHaveLength(2);
  });

  it('drops a line a 100% discount made free, as the issuer does', () => {
    const free: TicketWork = { ...work, items: [{ ...work.items[0], discount: 100 }, work.items[1]] };
    const groups = groupInvoiceLines(
      { lines: [line('החלפת רפידות', 1, 270), line('נוזל בלמים', 1, 45)] },
      [free],
    );
    expect(groups![0].parts.map((p) => p.desc)).toEqual(['נוזל בלמים']);
  });
});

describe('what reaches the database', () => {
  it('sends each line\'s discount with the works', async () => {
    let sent: any;
    setSupabaseClient({
      rpc: (_name: string, args: unknown) => {
        sent = args;
        return Promise.resolve({ data: { key: 'GAR-1', job: 'W-1' }, error: null });
      },
    } as unknown as SupabaseClient);
    await createTicket({ k: 'tmp', customer: 'יוסי', works: [work] } as Ticket);
    expect(sent.works[0].labor_discount).toBe(10);
    expect(sent.works[0].items[0].discount).toBe(15);
    expect(sent.works[0].items[1].discount).toBe(0);
  });
});
