import type { SupplierExpense, Ticket } from '@garage/shared';
import { describe, expect, it } from 'vitest';
import { agingTotals, bucketFor, customerAging, daysBetween, supplierAging } from './agingRollUp';

const TODAY = '2026-08-09';

const ticket = (over: Partial<Ticket>): Ticket => ({
  id: Math.random().toString(36).slice(2),
  k: 'GAR-1', st: 'done', type: 'job', epic: 'service', prio: 'med', pts: 3,
  who: null, job: '', title: 'work', plate: '', car: '',
  customer: 'דנה', amount: 1000, done: 0, subtasks: [], due: '', flags: [],
  paid: false, phone: '0501234567',
  closedAt: '2026-08-01T09:00:00.000Z',
  ...over,
} as Ticket);

const bill = (over: Partial<SupplierExpense>): SupplierExpense => ({
  id: Math.random().toString(36).slice(2),
  supplierId: 'sup-1', supplierName: 'ספק א',
  date: '2026-08-01',
  description: null, category: null, reference: null,
  subtotal: 1000, vatRate: 0.18, vat: 180, total: 1180,
  paid: false, dueDate: null, chequeNumber: null, chequeDate: null,
  provider: 'icount', providerExpenseId: null,
  syncStatus: 'synced', syncError: null,
  createdAt: '2026-08-01T00:00:00.000Z',
  ...over,
});

describe('daysBetween', () => {
  it('counts whole calendar days', () => {
    expect(daysBetween('2026-08-01', '2026-08-09')).toBe(8);
  });

  /* Both ends parsed as UTC, so the answer does not shift by a day when the
     reader's clock crosses a daylight-saving boundary. */
  it('is the same number across a month boundary', () => {
    expect(daysBetween('2026-07-31', '2026-08-01')).toBe(1);
  });

  it('is zero for a date it cannot read', () => {
    expect(daysBetween('צפי 23/07', TODAY)).toBe(0);
  });
});

describe('bucketFor', () => {
  it('puts the edges where the labels say', () => {
    expect(bucketFor(0)).toBe('current');
    expect(bucketFor(29)).toBe('current');
    expect(bucketFor(30)).toBe('thirty');
    expect(bucketFor(59)).toBe('thirty');
    expect(bucketFor(60)).toBe('sixty');
    expect(bucketFor(90)).toBe('ninety');
    expect(bucketFor(400)).toBe('ninety');
  });

  /* A bill due next month is not yet owed, which is not the same as freshly
     owed — but it is certainly not aged, and a fifth column for it would be
     noise. */
  it('treats a debt that is not due yet as current', () => {
    expect(bucketFor(-20)).toBe('current');
  });
});

describe('customerAging', () => {
  it('ages an unpaid finished job from the day the work was done', () => {
    const rows = customerAging([ticket({ closedAt: '2026-06-01T00:00:00.000Z' })], TODAY);
    expect(rows[0].oldest).toBe(69);
    expect(rows[0].buckets.sixty).toBe(1000);
  });

  it('ignores work that is still in progress', () => {
    expect(customerAging([ticket({ st: 'todo' })], TODAY)).toEqual([]);
  });

  it('ignores work that has been paid for', () => {
    expect(customerAging([ticket({ st: 'paid', paid: true })], TODAY)).toEqual([]);
    expect(customerAging([ticket({ paid: true })], TODAY)).toEqual([]);
  });

  /* A ticket no client has written since the migration. Aging it from today
     would drop a debt of unknown vintage into the newest bucket — the one place
     it is certain not to belong. */
  it('skips a ticket with no closing stamp rather than calling it new', () => {
    expect(customerAging([ticket({ closedAt: null })], TODAY)).toEqual([]);
  });

  it('rolls several jobs up under one customer', () => {
    const rows = customerAging([
      ticket({ customerId: 'c1', amount: 300, closedAt: '2026-08-01T00:00:00.000Z' }),
      ticket({ customerId: 'c1', amount: 700, closedAt: '2026-04-01T00:00:00.000Z' }),
    ], TODAY);

    expect(rows).toHaveLength(1);
    expect(rows[0].total).toBe(1000);
    expect(rows[0].buckets.current).toBe(300);
    expect(rows[0].buckets.ninety).toBe(700);
  });

  /* The oldest debt decides how alarming a row is: ₪800 nobody has paid in four
     months matters more than ₪8,000 from last week. */
  it('puts the oldest debt at the top, not the biggest', () => {
    const rows = customerAging([
      ticket({ customerId: 'big', customer: 'גדול', amount: 8000, closedAt: '2026-08-05T00:00:00.000Z' }),
      ticket({ customerId: 'old', customer: 'ותיק', amount: 800, closedAt: '2026-04-01T00:00:00.000Z' }),
    ], TODAY);
    expect(rows.map((r) => r.name)).toEqual(['ותיק', 'גדול']);
  });

  it('skips a job with nothing to pay for', () => {
    expect(customerAging([ticket({ amount: 0 })], TODAY)).toEqual([]);
  });
});

describe('supplierAging', () => {
  it('ages an unpaid bill from its due date, not the day it arrived', () => {
    const rows = supplierAging([bill({ date: '2026-01-01', dueDate: '2026-08-01' })], TODAY);
    expect(rows[0].oldest).toBe(8);
    expect(rows[0].buckets.current).toBe(1180);
  });

  it('leaves paid bills out', () => {
    expect(supplierAging([bill({ paid: true })], TODAY)).toEqual([]);
  });

  it('falls back to the bill date when nobody set a due date', () => {
    const rows = supplierAging([bill({ date: '2026-05-01', dueDate: null })], TODAY);
    expect(rows[0].buckets.ninety).toBe(1180);
  });
});

describe('agingTotals', () => {
  it('adds the columns up so the table foot matches the cards above it', () => {
    const rows = customerAging([
      ticket({ customerId: 'a', amount: 100, closedAt: '2026-08-05T00:00:00.000Z' }),
      ticket({ customerId: 'b', amount: 900, closedAt: '2026-01-01T00:00:00.000Z' }),
    ], TODAY);
    const totals = agingTotals(rows);

    expect(totals.total).toBe(1000);
    expect(totals.count).toBe(2);
    expect(totals.buckets.current).toBe(100);
    expect(totals.buckets.ninety).toBe(900);
  });

  it('is all zeroes for nothing', () => {
    expect(agingTotals([])).toMatchObject({ total: 0, count: 0 });
  });
});
