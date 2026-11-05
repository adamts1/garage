/* A price typed with VAT already in it, stored before VAT.

   The promise to the customer is the figure they were quoted: whatever is
   typed must come back to exactly that once VAT is added at the end. */

import { describe, expect, it } from 'vitest';
import { VAT, grossFromNet, netFromGross, worksSummary, type TicketWork } from './catalog';

describe('netFromGross', () => {
  it('stores 500 as the price that comes back to 500', () => {
    expect(netFromGross(500)).toBe(423.73);
    expect(grossFromNet(423.73)).toBe(500);
  });

  /* Not every figure is reachable: one agora before VAT is 1.18 after it, so
     about one gross in six falls between two stored prices. ₪2 is one — 1.69
     comes to 1.99 and 1.70 to 2.01. The nearest is then an agora away. */
  it('cannot always land exactly, and says how close it gets', () => {
    expect(grossFromNet(netFromGross(2))).toBe(1.99);
  });

  it('is never more than an agora off, up to ₪100 by the agora and ₪5,000 by the half shekel', () => {
    for (let agorot = 50; agorot <= 500_000; agorot += 50) {
      const gross = agorot / 100;
      expect(Math.abs(grossFromNet(netFromGross(gross)) - gross)).toBeLessThanOrEqual(0.01 + 1e-9);
    }
    for (let agorot = 1; agorot <= 10_000; agorot++) {
      const gross = agorot / 100;
      expect(Math.abs(grossFromNet(netFromGross(gross)) - gross)).toBeLessThanOrEqual(0.01 + 1e-9);
    }
  });

  it('takes the rate it is given', () => {
    expect(netFromGross(117, 0.17)).toBe(100);
    expect(netFromGross(100, 0)).toBe(100);
  });

  it('is zero for nothing, a negative or nonsense', () => {
    expect(netFromGross(0)).toBe(0);
    expect(netFromGross(-5)).toBe(0);
    expect(netFromGross(Number.NaN)).toBe(0);
  });

  it('a ticket of one such line totals to the quoted figure', () => {
    const work: TicketWork = {
      uid: 'w1', code: 'OIL', name: 'החלפת שמן', labor: netFromGross(350),
      items: [{ sku: 'F-1', name: 'מסנן', qty: 1, price: netFromGross(150) }],
    };
    const net = work.labor + work.items[0].price;
    expect(Math.round(net * (1 + VAT) * 100) / 100).toBe(500);
    expect(worksSummary([work]).net).toBeCloseTo(423.73, 2);
  });
});
