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

  it('never bills above the typed total with fractional quantities', () => {
    const cases = [
      [{ desc: 'שמן', qty: 0.7, unit_price: 56.58 }, { desc: 'נוזל', qty: 0.5, unit_price: 41.3 }],
      [{ desc: 'מגבים', qty: 1.5, unit_price: 33.33 }],
      [{ desc: 'שמן', qty: 0.7, unit_price: 30.55 }, { desc: 'נוזל', qty: 0.5, unit_price: 41.3 }],
      [{ desc: 'שמן', qty: 2.5, unit_price: 19.9 }, { desc: 'פילטר', qty: 3, unit_price: 12.4 }],
    ];
    for (const lines of cases) {
      const res = inclVatLines(lines, 0.18);
      const off = r2(res.gross - res.total);
      expect(off).toBeGreaterThanOrEqual(0);
      expect(off).toBeLessThanOrEqual(0.01);
      expect(res.lines.every((l) => l.qty > 0 && l.unit_price >= 0)).toBe(true);
      expect(r2(res.lines.reduce((s, l) => s + l.qty * l.unit_price, 0))).toBe(res.subtotal);
    }
  });

  it('holds over many random lines', () => {
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let n = 0; n < 20000; n++) {
      const lines = Array.from({ length: 1 + Math.floor(rnd() * 4) }, (_, i) => ({
        desc: `l${i}`,
        qty: rnd() < 0.5 ? 1 + Math.floor(rnd() * 4) : r2(0.1 + rnd() * 3),
        unit_price: r2(1 + rnd() * 400),
      }));
      const res = inclVatLines(lines, 0.18);
      const off = r2(res.gross - res.total);
      expect(off).toBeGreaterThanOrEqual(0);
      expect(off).toBeLessThanOrEqual(0.01);
      expect(res.lines.every((l) => l.qty > 0 && l.unit_price >= 0)).toBe(true);
      // issue-invoice adds the lines up again itself: it must land on the same figure.
      expect(r2(res.lines.reduce((s, l) => s + l.qty * l.unit_price, 0))).toBe(res.subtotal);
    }
  });
});
