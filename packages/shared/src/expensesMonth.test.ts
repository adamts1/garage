import { describe, expect, it } from 'vitest';
import { expenseTotals, isOverdue, monthOf, shiftMonth, type SupplierExpense } from './expenses';

const e = (over: Partial<SupplierExpense>): SupplierExpense => ({
  id: 'x', supplierId: 's', supplierName: 'ספק', date: '2026-11-12', description: null, category: null,
  reference: null, lines: [], subtotal: 100, vatRate: 0.18, vat: 18, total: 118, paid: false,
  dueDate: null, chequeNumber: null, chequeDate: null, source: 'manual', scanId: null,
  provider: 'icount', providerExpenseId: null, syncStatus: 'pending', syncError: null, createdAt: '',
  ...over,
});

describe('months', () => {
  it('reads the month of a date', () => {
    expect(monthOf('2026-11-12')).toBe('2026-11');
  });
  it('steps across a year in both directions', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-11', 0)).toBe('2026-11');
    expect(shiftMonth('2026-03', -14)).toBe('2025-01');
  });
});

describe('expenseTotals', () => {
  it('adds everything, and what is still owed', () => {
    const t = expenseTotals([e({ total: 118 }), e({ total: 59, paid: true }), e({ total: 0.1 }), e({ total: 0.2 })]);
    expect(t.total).toBe(177.3);
    expect(t.unpaid).toBe(118.3);
  });
  it('is zero for no expenses', () => {
    expect(expenseTotals([])).toEqual({ total: 0, unpaid: 0 });
  });
});

describe('isOverdue', () => {
  it('uses the due date when there is one', () => {
    expect(isOverdue(e({ dueDate: '2026-11-17' }), '2026-11-18')).toBe(true);
    expect(isOverdue(e({ dueDate: '2026-11-18' }), '2026-11-18')).toBe(false);
  });
  it('falls back to the invoice date — owed on receipt', () => {
    expect(isOverdue(e({ date: '2026-11-01' }), '2026-11-18')).toBe(true);
  });
  it('is never overdue once paid', () => {
    expect(isOverdue(e({ date: '2026-01-01', paid: true }), '2026-11-18')).toBe(false);
  });
});
