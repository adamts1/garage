import type { SupplierExpense } from '@garage/shared';
import { describe, expect, it } from 'vitest';
import { byMonth, bySupplier, obligoTotals } from './obligoRollUp';

const TODAY = '2026-08-09';

const bill = (over: Partial<SupplierExpense>): SupplierExpense => ({
  id: Math.random().toString(36).slice(2),
  supplierId: 'sup-1', supplierName: 'ספק א',
  date: '2026-08-01',
  description: null, category: null, reference: null,
  subtotal: 1000, vatRate: 0.18, vat: 180, total: 1180,
  paid: false,
  dueDate: null, chequeNumber: null, chequeDate: null,
  provider: 'icount', providerExpenseId: null,
  syncStatus: 'synced', syncError: null,
  createdAt: '2026-08-01T00:00:00.000Z',
  ...over,
});

describe('bySupplier', () => {
  it('adds up what each supplier is still owed', () => {
    const rows = bySupplier([bill({}), bill({ total: 820 })], TODAY);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ supplier: 'ספק א', count: 2, total: 2000 });
  });

  /* Obligo is a commitment. A bill that has been paid is not one — where the
     money went is the expenses page's question. */
  it('leaves paid bills out', () => {
    expect(bySupplier([bill({ paid: true })], TODAY)).toEqual([]);
  });

  it('separates suppliers and puts the biggest first', () => {
    const rows = bySupplier([
      bill({ supplierId: 'a', supplierName: 'קטן', total: 100 }),
      bill({ supplierId: 'b', supplierName: 'גדול', total: 900 }),
    ], TODAY);
    expect(rows.map((r) => r.supplier)).toEqual(['גדול', 'קטן']);
  });

  it('names the oldest thing still owed', () => {
    const rows = bySupplier([
      bill({ dueDate: '2026-08-30' }),
      bill({ dueDate: '2026-06-01' }),
    ], TODAY);
    expect(rows[0].oldestDue).toBe('2026-06-01');
  });

  it('counts what is past its due date as overdue', () => {
    const rows = bySupplier([
      bill({ dueDate: '2026-06-01', total: 500 }),   // past
      bill({ dueDate: '2026-09-01', total: 700 }),   // not yet
    ], TODAY);
    expect(rows[0]).toMatchObject({ total: 1200, overdue: 500 });
  });

  /* A blank due date means on receipt, so the bill's own date is the due date —
     the fallback lives in dueOn(), and this is the report relying on it. */
  it('treats a bill with no due date as due when it was issued', () => {
    const rows = bySupplier([bill({ date: '2026-05-01', dueDate: null })], TODAY);
    expect(rows[0].overdue).toBe(1180);
    expect(rows[0].oldestDue).toBe('2026-05-01');
  });
});

describe('byMonth', () => {
  it('lands an unpaid bill on the month it is due', () => {
    const rows = byMonth([bill({ dueDate: '2026-09-15' })]);
    expect(rows).toEqual([{ month: '2026-09', count: 1, total: 1180, onCheques: 0 }]);
  });

  /* The whole reason cheque dates are stored. A bill due in August and paid by
     a cheque dated November leaves the account in November, and a cash-flow
     report that says August is answering a different question. */
  it('lands a bill on its cheque date, not its due date', () => {
    const rows = byMonth([bill({ paid: true, dueDate: '2026-08-15', chequeDate: '2026-11-01' })]);
    expect(rows).toEqual([{ month: '2026-11', count: 1, total: 1180, onCheques: 1180 }]);
  });

  /* Money already gone, on a day nobody wrote down. Inventing one would put
     spent money into a future the garage is planning around. */
  it('drops a paid bill with no cheque date', () => {
    expect(byMonth([bill({ paid: true, dueDate: '2026-08-15' })])).toEqual([]);
  });

  it('orders the months earliest first', () => {
    const rows = byMonth([
      bill({ dueDate: '2026-12-01' }),
      bill({ dueDate: '2026-09-01' }),
    ]);
    expect(rows.map((r) => r.month)).toEqual(['2026-09', '2026-12']);
  });
});

describe('obligoTotals', () => {
  it('counts everything unpaid, and the overdue part of it', () => {
    const totals = obligoTotals([
      bill({ dueDate: '2026-06-01', total: 500 }),
      bill({ dueDate: '2026-09-01', total: 700 }),
      bill({ paid: true, total: 9999 }),
    ], TODAY);
    expect(totals).toMatchObject({ outstanding: 1200, overdue: 500, suppliers: 1 });
  });

  it('counts money promised on cheques that have not landed yet', () => {
    const totals = obligoTotals([
      bill({ paid: true, chequeDate: '2026-11-01', total: 300 }),  // still to come
      bill({ paid: true, chequeDate: '2026-01-01', total: 400 }),  // long gone
    ], TODAY);
    expect(totals.onFutureCheques).toBe(300);
  });

  it('counts distinct suppliers, not bills', () => {
    const totals = obligoTotals([
      bill({ supplierId: 'a' }), bill({ supplierId: 'a' }), bill({ supplierId: 'b' }),
    ], TODAY);
    expect(totals.suppliers).toBe(2);
  });
});
