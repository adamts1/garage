import { describe, expect, it } from 'vitest';
import { previewTotals } from './useExpenses';

describe('previewTotals', () => {
  it('adds VAT on top of the subtotal', () => {
    // An expense is entered net — the supplier's invoice states both.
    expect(previewTotals('100', '0.18')).toEqual({ subtotal: 100, vat: 18, total: 118 });
  });

  it('handles the zero-VAT case', () => {
    expect(previewTotals('250', '0')).toEqual({ subtotal: 250, vat: 0, total: 250 });
  });

  it('rounds to the agora rather than carrying binary dust', () => {
    // 33.33 * 0.18 = 5.9994, which must not reach the books as 5.9994.
    const { vat, total } = previewTotals('33.33', '0.18');
    expect(vat).toBe(6);
    expect(total).toBe(39.33);
  });

  it('keeps the total equal to subtotal plus the rounded VAT', () => {
    for (const amount of ['1', '19.99', '33.33', '1234.56', '0.01']) {
      const { subtotal, vat, total } = previewTotals(amount, '0.18');
      expect(total).toBeCloseTo(subtotal + vat, 10);
    }
  });

  it('treats an empty field as zero rather than NaN', () => {
    // The field starts blank, so this is the state the form opens in.
    expect(previewTotals('', '0.18')).toEqual({ subtotal: 0, vat: 0, total: 0 });
  });

  it('treats unparseable input as zero', () => {
    expect(previewTotals('abc', '0.18')).toEqual({ subtotal: 0, vat: 0, total: 0 });
  });
});
