/* Obligo — what the garage is committed to paying, and when.
 *
 * Two questions that look like one:
 *
 *   BY SUPPLIER  "who am I into, and for how much" — the number to have in your
 *                head before ordering another gearbox from them.
 *   BY MONTH     "what leaves the account, and when" — cash flow. A garage that
 *                owes ₪40,000 is fine if it is spread over four months and in
 *                trouble if it all clears next Tuesday.
 *
 * The second is why cheque dates are stored at all. A bill's due date is when
 * the supplier is owed; the date on a post-dated cheque is when the money
 * actually goes, and they are routinely months apart. Grouping unpaid bills by
 * due date and paid-by-cheque bills by cheque date is the only way one column
 * answers "when does this hit the account" for both.
 */

import { dueOn, type SupplierExpense } from '@garage/shared';

export interface SupplierObligo {
  supplierId: string;
  supplier: string;
  /** Unpaid bills from this supplier. */
  count: number;
  total: number;
  /** The oldest thing still owed them, as YYYY-MM-DD. Empty when nothing is. */
  oldestDue: string;
  /** Owed past its due date, as of the day the report was asked for. */
  overdue: number;
}

/** What is still owed, by supplier, biggest first.
 *
 *  Paid bills are gone from here entirely — obligo is a commitment, and a bill
 *  that has been paid is not one. Where the money went is the expenses page's
 *  question, not this one's. */
export function bySupplier(expenses: readonly SupplierExpense[], today: string): SupplierObligo[] {
  const byId = new Map<string, SupplierObligo>();

  for (const e of expenses) {
    if (e.paid) continue;
    const key = e.supplierId;
    const row = byId.get(key) ?? {
      supplierId: key,
      supplier: e.supplierName ?? '—',
      count: 0,
      total: 0,
      oldestDue: '',
      overdue: 0,
    };
    const due = dueOn(e);
    row.count += 1;
    row.total = round2(row.total + e.total);
    if (!row.oldestDue || due < row.oldestDue) row.oldestDue = due;
    if (due < today) row.overdue = round2(row.overdue + e.total);
    byId.set(key, row);
  }

  return [...byId.values()].sort((a, b) => b.total - a.total);
}

export interface MonthObligo {
  /** YYYY-MM. */
  month: string;
  count: number;
  total: number;
  /** Of that, what is committed to a cheque with a date on it — money whose day
   *  is already decided, as opposed to a bill that is merely due. */
  onCheques: number;
}

/** When the money leaves, by month, earliest first.
 *
 *  A bill lands on its cheque date when it has one and on its due date when it
 *  does not. Paid bills WITHOUT a cheque date are dropped: the money has already
 *  gone, on a day nobody recorded, and inventing one would put spent money into
 *  a future the garage is planning around. */
export function byMonth(expenses: readonly SupplierExpense[]): MonthObligo[] {
  const byMonthKey = new Map<string, MonthObligo>();

  for (const e of expenses) {
    const lands = e.chequeDate || (e.paid ? null : dueOn(e));
    if (!lands) continue;

    const month = lands.slice(0, 7);
    const row = byMonthKey.get(month) ?? { month, count: 0, total: 0, onCheques: 0 };
    row.count += 1;
    row.total = round2(row.total + e.total);
    if (e.chequeDate) row.onCheques = round2(row.onCheques + e.total);
    byMonthKey.set(month, row);
  }

  return [...byMonthKey.values()].sort((a, b) => a.month.localeCompare(b.month));
}

export interface ObligoTotals {
  /** Everything unpaid. */
  outstanding: number;
  /** Of that, already past its due date. */
  overdue: number;
  /** Committed to a cheque dated today or later — money the garage has promised
   *  and not yet parted with. */
  onFutureCheques: number;
  suppliers: number;
}

export function obligoTotals(expenses: readonly SupplierExpense[], today: string): ObligoTotals {
  const unpaid = expenses.filter((e) => !e.paid);
  return {
    outstanding: round2(unpaid.reduce((s, e) => s + e.total, 0)),
    overdue: round2(unpaid.filter((e) => dueOn(e) < today).reduce((s, e) => s + e.total, 0)),
    onFutureCheques: round2(
      expenses.filter((e) => e.chequeDate && e.chequeDate >= today).reduce((s, e) => s + e.total, 0),
    ),
    suppliers: new Set(unpaid.map((e) => e.supplierId)).size,
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;
