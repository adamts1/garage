/* Aging — a debt sorted by how long it has been one.
 *
 * The point of the report is not the total. A garage knows roughly what it is
 * owed; what it does not know is which part of that has been sitting there
 * since March. ₪20,000 owed across this month is a business running normally,
 * and the same ₪20,000 ninety days old is money somebody has to go and ask for.
 *
 * TWO SIDES, TWO CLOCKS
 *
 * What customers owe is aged from the day the WORK FINISHED — tickets.closed_at,
 * stamped by the database when a ticket first reaches 'done' or 'paid'. It is
 * deliberately not the invoice date: a garage that closes a job and invoices it
 * three weeks later has been owed that money for three weeks, and dating the
 * debt from the paperwork would hide exactly the delay worth seeing. It is also
 * what makes the report work at all today, since a ticket can be finished and
 * unpaid without any document having been issued for it.
 *
 * Not `due`, which looks like a date and is not: it is free text an advisor
 * writes "צפי 23/07" and "ממתין אישור" into. Aging by it would put every debt in
 * the newest bucket and say nothing, quietly.
 *
 * What the garage owes is aged from the DUE DATE, because that is the day the
 * supplier started waiting. A bill with sixty-day terms is not overdue on the
 * day it arrives, and treating it as such would put every ordinary bill in the
 * oldest bucket and make the report say nothing.
 */

import { dueOn, type SupplierExpense, type Ticket } from '@garage/shared';

/** The four buckets, in days. Standard practice, and the reason it is standard
 *  is that a month is how long a customer takes to pay when nothing is wrong. */
export const BUCKETS = [
  { id: 'current', upTo: 30 },
  { id: 'thirty', upTo: 60 },
  { id: 'sixty', upTo: 90 },
  { id: 'ninety', upTo: Infinity },
] as const;

export type BucketId = typeof BUCKETS[number]['id'];

/** Whole days between two YYYY-MM-DD dates. Parsed as UTC on both sides, so the
 *  answer is a count of calendar days and not an hours-apart figure that flips
 *  across a daylight-saving boundary. */
export const daysBetween = (from: string, to: string): number => {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.floor((b - a) / 86_400_000);
};

/** Which bucket an age falls in. Negative ages — a bill due next month — are
 *  current: not yet owed is not the same as freshly owed, but it is certainly
 *  not aged, and a fifth bucket for it would be a column of noise. */
export const bucketFor = (ageInDays: number): BucketId => {
  for (const b of BUCKETS) if (ageInDays < b.upTo) return b.id;
  return 'ninety';
};

export interface AgingRow {
  id: string;
  name: string;
  /** Phone for a customer, nothing for a supplier. */
  sub: string;
  total: number;
  buckets: Record<BucketId, number>;
  /** The single oldest debt in the row, in days — what decides how alarming the
   *  row is, and what it sorts by. */
  oldest: number;
}

const emptyBuckets = (): Record<BucketId, number> =>
  ({ current: 0, thirty: 0, sixty: 0, ninety: 0 });

const round2 = (n: number) => Math.round(n * 100) / 100;

const add = (row: AgingRow, amount: number, age: number) => {
  row.total = round2(row.total + amount);
  const b = bucketFor(age);
  row.buckets[b] = round2(row.buckets[b] + amount);
  if (age > row.oldest) row.oldest = age;
};

/* ---------- what customers owe ---------- */

/** Closed-but-unpaid work, by customer, aged from the day it was finished.
 *
 *  A ticket counts when the work is done and the money is not in. 'paid' is
 *  settled by definition, and anything earlier than 'done' is work in progress —
 *  the customer does not owe for a car still on the lift.
 *
  *  A ticket with no closed_at is skipped rather than aged from today. The
 *  column is backfilled and stamped by a trigger, so a missing one means a row
 *  no client has written since the migration — and inventing an age for it would
 *  put a debt of unknown vintage in the newest bucket, which is the one place it
 *  is certain not to belong. */
export function customerAging(tickets: readonly Ticket[], today: string): AgingRow[] {
  const byCustomer = new Map<string, AgingRow>();

  for (const t of tickets) {
    if (t.st !== 'done' || t.paid) continue;
    if (!(t.amount > 0)) continue;
    const closed = t.closedAt?.slice(0, 10);
    if (!closed) continue;

    const key = t.customerId ?? (t.phone ? `phone:${t.phone}` : `name:${t.customer}`);
    const row = byCustomer.get(key) ?? {
      id: key,
      name: t.customer || '—',
      sub: t.phone ?? '',
      total: 0,
      buckets: emptyBuckets(),
      oldest: 0,
    };
    add(row, t.amount, daysBetween(closed, today));
    byCustomer.set(key, row);
  }

  return [...byCustomer.values()].sort((a, b) => b.oldest - a.oldest || b.total - a.total);
}

/* ---------- what the garage owes ---------- */

/** Unpaid supplier bills, by supplier, aged from their due date. */
export function supplierAging(expenses: readonly SupplierExpense[], today: string): AgingRow[] {
  const bySupplier = new Map<string, AgingRow>();

  for (const e of expenses) {
    if (e.paid) continue;
    const row = bySupplier.get(e.supplierId) ?? {
      id: e.supplierId,
      name: e.supplierName ?? '—',
      sub: '',
      total: 0,
      buckets: emptyBuckets(),
      oldest: 0,
    };
    add(row, e.total, daysBetween(dueOn(e), today));
    bySupplier.set(e.supplierId, row);
  }

  return [...bySupplier.values()].sort((a, b) => b.oldest - a.oldest || b.total - a.total);
}

/** Column totals, so the foot of the table adds up to the KPI above it. */
export function agingTotals(rows: readonly AgingRow[]) {
  const buckets = emptyBuckets();
  let total = 0;
  for (const r of rows) {
    total = round2(total + r.total);
    for (const b of BUCKETS) buckets[b.id] = round2(buckets[b.id] + r.buckets[b.id]);
  }
  return { total, buckets, count: rows.length };
}
