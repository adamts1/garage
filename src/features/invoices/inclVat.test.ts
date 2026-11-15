import { describe, expect, it } from 'vitest';
import { inclVatLines } from './inclVat';

const r2 = (n: number) => Math.round(n * 100) / 100;

describe('counter sale prices that include VAT', () => {
  it('lands on the typed total when it can be reached', () => {
    const res = inclVatLines([{ desc: 'שמן', qty: 1, unit_price: 118 }], 0.18);
    expect(res).toMatchObject({ subtotal: 100, vat: 18, total: 118 });
  });

  it('is never more than an agora off, however many lines and quantities', () => {
    for (let a = 1; a <= 300; a += 7) {
      for (const q of [1, 2, 3, 5]) {
        const lines = [
          { desc: 'פילטר', qty: q, unit_price: a + 0.9 },
          { desc: 'שמן', qty: 1, unit_price: 2 * a },
          { desc: 'נוזל', qty: 4, unit_price: 12.5 },
        ];
        const res = inclVatLines(lines, 0.18);
        const off = r2(res.gross - res.total);
        expect(off).toBeGreaterThanOrEqual(0);
        expect(off).toBeLessThanOrEqual(0.01);
        // What the document says is what it adds up to.
        expect(r2(res.lines.reduce((s, l) => s + l.qty * l.unit_price, 0))).toBe(res.subtotal);
      }
    }
  });

  it('cannot reach ₪100 exactly and stops an agora below it', () => {
    expect(inclVatLines([{ desc: 'בדיקה', qty: 1, unit_price: 100 }], 0.18).total).toBe(99.99);
  });

  it('keeps the description on a unit split off to carry the rounding', () => {
    const res = inclVatLines([{ desc: 'מגבים', qty: 3, unit_price: 33.33 }], 0.18);
    expect(res.lines.every((l) => l.desc === 'מגבים')).toBe(true);
    expect(res.lines.reduce((s, l) => s + l.qty, 0)).toBe(3);
  });
});
