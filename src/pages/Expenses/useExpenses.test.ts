import { describe, expect, it } from 'vitest';
import type { SupplierExpense } from '@garage/shared';
import {
  blankLine, draftSubtotal, filterExpenses, NO_FILTERS, previewTotals, readyLines, type DraftLine,
} from './useExpenses';

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

describe('the items on an expense', () => {
  const line = (desc: string, qty: string, unitPrice: string): DraftLine => ({ ...blankLine(), desc, qty, unitPrice });

  it('adds up quantity times price, to the agora', () => {
    expect(draftSubtotal([line('פילטר שמן', '3', '19.90'), line('שמן 5W30', '1', '120')])).toBe(179.7);
  });

  it('drops a line nobody touched', () => {
    expect(readyLines([line('בלמים', '2', '50'), blankLine()])).toEqual({
      lines: [{ desc: 'בלמים', qty: 2, unit_price: 50 }], incomplete: false,
    });
  });

  it('refuses a price with no item rather than saving a smaller expense', () => {
    expect(readyLines([line('', '1', '80')]).incomplete).toBe(true);
  });

  it('refuses an item with no quantity', () => {
    expect(readyLines([line('מגבים', '0', '40')]).incomplete).toBe(true);
  });
});

describe('filterExpenses', () => {
  const exp = (over: Partial<SupplierExpense>): SupplierExpense => ({
    id: Math.random().toString(36).slice(2), supplierId: 's1', supplierName: 'ספק חלפים מרכזי',
    date: '2026-11-02', description: null, category: null, reference: null, lines: [],
    subtotal: 100, vatRate: 0.18, vat: 18, total: 118, paid: false,
    dueDate: null, chequeNumber: null, chequeDate: null,
    provider: 'icount', providerExpenseId: null, syncStatus: 'synced', syncError: null,
    createdAt: '2026-11-02T00:00:00.000Z', ...over,
  });
  const rows = [
    exp({ id: 'a', reference: 'INV-4587', paid: true }),
    exp({ id: 'b', supplierId: 's2', supplierName: 'חלפי רכב', date: '2026-10-30', syncStatus: 'pending' }),
    exp({ id: 'c', lines: [{ desc: 'רפידות בלם', qty: 2, unit_price: 50 }] }),
  ];
  const ids = (f: Partial<typeof NO_FILTERS>) => filterExpenses(rows, { ...NO_FILTERS, ...f }).map((e) => e.id);

  it('shows everything unfiltered', () => expect(ids({})).toEqual(['a', 'b', 'c']));
  it('by supplier', () => expect(ids({ supplierId: 's2' })).toEqual(['b']));
  it('by month', () => expect(ids({ month: '2026-10' })).toEqual(['b']));
  it('by payment and sync status', () => {
    expect(ids({ status: 'paid' })).toEqual(['a']);
    expect(ids({ status: 'unpaid' })).toEqual(['b', 'c']);
    expect(ids({ status: 'unsynced' })).toEqual(['b']);
  });
  it('searches the document number and the items', () => {
    expect(ids({ query: 'inv-45' })).toEqual(['a']);
    expect(ids({ query: 'בלם' })).toEqual(['c']);
  });
});
