/* מחיר סופי לכרטיס — a final price for the whole ticket.

   What is pinned: the screens and the invoice land on exactly the price the
   admin typed, the lines keep their own prices on the screen, a price above
   the lines is not applied, and the invoice spread adds up to the agora.
   issue-invoice repeats spreadToNet in Deno; the two must agree. */

import { describe, expect, it } from 'vitest';
import {
  finalPriceExcess, finalPriceNet, spreadToNet, worksCharged, worksSummary, type TicketWork,
} from './catalog';
import type { Ticket } from './types';
import { waMessage } from './waMessage';

const brakes: TicketWork = {
  uid: 'w1', code: 'BRK', name: 'בלמים', labor: 400,
  items: [
    { sku: 'P1', name: 'רפידות', qty: 2, price: 180 },
    { sku: 'P2', name: 'נוזל בלמים', qty: 1, price: 45.5 },
  ],
};
const oil: TicketWork = {
  uid: 'w2', code: 'OIL', name: 'טיפול', labor: 250,
  items: [{ sku: 'F1', name: 'מסנן', qty: 3, price: 33.33 }],
};
const works = [brakes, oil];
// 400 + 360 + 45.5 + 250 + 99.99 = 1155.49 before VAT; 1363.48 with it.

describe('finalPriceNet / worksSummary', () => {
  it('a final price below the lines totals to exactly that price', () => {
    const sum = worksSummary(works, 1200);
    expect(sum.total).toBe(1200);
    expect(sum.ticketDiscount).toBeCloseTo(worksCharged(works) - sum.net, 2);
    expect(sum.ticketDiscount).toBeGreaterThan(0);
  });

  it('leaves the lines as they show — the discount is said, not spread, on screen', () => {
    const sum = worksSummary(works, 1200);
    expect(sum.labor).toBe(650);
    expect(sum.parts).toBeCloseTo(505.49, 2);
  });

  it('none set, or a price not below the lines, changes nothing', () => {
    const plain = worksSummary(works);
    expect(worksSummary(works, null)).toEqual(plain);
    expect(worksSummary(works, 0)).toEqual(plain);
    expect(worksSummary(works, 5000)).toEqual(plain);
    expect(finalPriceNet(works, 5000)).toBeNull();
  });
});

describe('finalPriceExcess', () => {
  it('is how far a price is above the lines with VAT, and 0 otherwise', () => {
    const total = worksSummary(works).total;
    expect(finalPriceExcess(works, total + 100)).toBeCloseTo(100, 2);
    expect(finalPriceExcess(works, total)).toBe(0);
    expect(finalPriceExcess(works, 900)).toBe(0);
    expect(finalPriceExcess(works, null)).toBe(0);
  });
});

describe('spreadToNet', () => {
  const lines = [
    { unitprice: 400, quantity: 1 },
    { unitprice: 180, quantity: 2 },
    { unitprice: 45.5, quantity: 1 },
    { unitprice: 250, quantity: 1 },
    { unitprice: 33.33, quantity: 3 },
  ];
  const sumOf = (ls: { unitprice: number; quantity: number }[]) =>
    Math.round(ls.reduce((s, l) => s + l.unitprice * l.quantity, 0) * 100) / 100;

  it('adds up to exactly the target, to the agora', () => {
    for (const net of [1016.95, 1000, 777.77, 123.45, 1155.48]) {
      const { lines: out } = spreadToNet(lines, net);
      expect(sumOf(out)).toBe(net);
      expect(out.every((l) => l.unitprice > 0)).toBe(true);
    }
  });

  it('keeps the order and quantities when a line of one can take the rounding', () => {
    const { lines: out, split } = spreadToNet(lines, 1000);
    expect(split).toBeNull();
    expect(out.map((l) => l.quantity)).toEqual([1, 2, 1, 1, 3]);
  });

  it('splits a unit off the largest line when every line has a larger quantity', () => {
    const multi = [{ unitprice: 33.33, quantity: 3 }, { unitprice: 10, quantity: 7 }];
    const { lines: out, split } = spreadToNet(multi, 150);
    expect(sumOf(out)).toBe(150);
    expect(split).toBe(0);
    expect(out.map((l) => l.quantity)).toEqual([2, 1, 7]);
  });

  it('never raises a price', () => {
    expect(spreadToNet(lines, 2000).lines).toEqual(lines);
  });
});

describe('the WhatsApp message', () => {
  it('says the ticket discount and totals to the final price', () => {
    const ticket = { customer: 'דנה', car: 'מאזדה', plate: '1234567', title: '', paid: false, works, finalPrice: 1200 } as
      Pick<Ticket, 'customer' | 'car' | 'plate' | 'title' | 'paid' | 'works' | 'finalPrice'>;
    const text = waMessage({ ticket, closed: false, total: 1200 });
    expect(text).toContain('הנחה על הכרטיס');
    expect(text).toContain('1,200');
  });
});
