import {
  createExpense, deleteExpense, listExpenses, listSuppliers, setExpensePaid,
  linesSubtotal, subscribeToExpenses,
  type ExpenseLine, type Supplier, type SupplierExpense,
} from '@garage/shared';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { showError, showErrorKey, showSuccess, useAppDispatch, useBusyRun, useConfirm } from '../../store';

export interface ExpenseDraft {
  supplierId: string;
  date: string;
  description: string;
  category: string;
  reference: string;
  /** The items on the supplier's invoice. Strings, because they are what was
   *  typed; readyLines() turns them into figures. */
  lines: DraftLine[];
  vatRate: string;
  paid: boolean;
  /** Blank means on receipt — see dueOn() in @garage/shared. */
  dueDate: string;
  chequeNumber: string;
  chequeDate: string;
}

export interface DraftLine {
  /** Local only — React needs a stable key. */
  uid: string;
  desc: string;
  qty: string;
  unitPrice: string;
}

let lineSeq = 0;
export const blankLine = (): DraftLine => ({ uid: `l${lineSeq++}`, desc: '', qty: '1', unitPrice: '' });

/** The typed lines as figures, and whether any of them is half-filled.
 *
 *  A line nobody touched is dropped. A line with a price but no description,
 *  or a description with no quantity, is not — it is reported as incomplete,
 *  because quietly leaving it out would save a smaller expense than the one on
 *  the supplier's invoice. */
export function readyLines(lines: readonly DraftLine[]): { lines: ExpenseLine[]; incomplete: boolean } {
  const out: ExpenseLine[] = [];
  let incomplete = false;
  for (const l of lines) {
    const desc = l.desc.trim();
    const qty = Number(l.qty) || 0;
    const unitPrice = Number(l.unitPrice) || 0;
    if (!desc && !l.unitPrice.trim()) continue;
    if (!desc || qty <= 0 || unitPrice < 0) { incomplete = true; continue; }
    out.push({ desc, qty, unit_price: unitPrice });
  }
  return { lines: out, incomplete };
}

/** The pre-VAT sum of the lines, as the form shows it. */
export const draftSubtotal = (lines: readonly DraftLine[]) => linesSubtotal(readyLines(lines).lines);

export const today = () => new Date().toISOString().slice(0, 10);

export const blankExpense = (): ExpenseDraft => ({
  supplierId: '', date: today(), description: '', category: '',
  reference: '', lines: [blankLine()], vatRate: '0.18', paid: false,
  dueDate: '', chequeNumber: '', chequeDate: '',
});

/** Rounded to the agora, because that is the unit an invoice is issued in. */
const round2 = (n: number) => Math.round(n * 100) / 100;

/** The live figures under the add form. Pure, so the arithmetic can be tested
 *  without rendering anything. */
export function previewTotals(subtotal: string, vatRate: string) {
  const sub = Number(subtotal) || 0;
  const rate = Number(vatRate) || 0;
  const vat = round2(sub * rate);
  return { subtotal: sub, vat, total: round2(sub + vat) };
}

export type ExpenseStatusFilter = 'all' | 'paid' | 'unpaid';

export interface ExpenseFilters {
  supplierId: string;   // '' = every supplier
  month: string;        // YYYY-MM, '' = any
  status: ExpenseStatusFilter;
  query: string;
}

export const NO_FILTERS: ExpenseFilters = { supplierId: '', month: '', status: 'all', query: '' };

/** The rows the filter bar asks for. Pure, so it can be tested on its own.
 *  The search reads the supplier, the supplier's document number, the
 *  description and the items — what someone holding the paper would type. */
export function filterExpenses(rows: readonly SupplierExpense[], f: ExpenseFilters): SupplierExpense[] {
  const q = f.query.trim().toLowerCase();
  return rows.filter((e) => {
    if (f.supplierId && e.supplierId !== f.supplierId) return false;
    if (f.month && !e.date.startsWith(f.month)) return false;
    if (f.status === 'paid' && !e.paid) return false;
    if (f.status === 'unpaid' && e.paid) return false;
    if (!q) return true;
    return [e.supplierName, e.reference, e.description, e.category, ...e.lines.map((l) => l.desc)]
      .some((v) => v?.toLowerCase().includes(q));
  });
}

export function useExpenses() {
  const dispatch = useAppDispatch();
  const run = useBusyRun();
  const confirm = useConfirm();
  const [rows, setRows] = useState<SupplierExpense[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [busy, setBusy] = useState(false);
  const [filters, setFilters] = useState<ExpenseFilters>(NO_FILTERS);
  const shown = useMemo(() => filterExpenses(rows, filters), [rows, filters]);
  const usedCategories = useMemo(
    () => [...new Set(rows.map((e) => e.category ?? '').filter(Boolean))].sort(),
    [rows],
  );

  const load = useCallback(() => {
    listExpenses().then(setRows).catch((e) => dispatch(showError(e)));
    listSuppliers().then(setSuppliers).catch(() => {});
  }, [dispatch]);

  useEffect(() => {
    load();
    return subscribeToExpenses(load);
  }, [load]);

  const create = useCallback(
    async (draft: ExpenseDraft) => {
      const { lines, incomplete } = readyLines(draft.lines);
      const subtotal = linesSubtotal(lines);
      if (!draft.supplierId || incomplete || !(subtotal > 0)) return false;
      setBusy(true);
      try {
        await run('busy.savingExpense', () => createExpense({
          supplierId: draft.supplierId,
          date: draft.date,
          description: draft.description,
          category: draft.category,
          reference: draft.reference,
          lines,
          subtotal,
          vatRate: Number(draft.vatRate),
          paid: draft.paid,
          /* Empty strings become nulls: a date input left alone is "nobody
             said", and storing '' would be a date the database has to reject. */
          dueDate: draft.dueDate || null,
          chequeNumber: draft.chequeNumber || null,
          chequeDate: draft.chequeDate || null,
        }));

        /* Saved here only. Pushing expenses to iCount was switched off on
           2026-11-12 (the garage's choice); record-expense and the sync columns
           are left in place so it can come back without a migration. */
        dispatch(showSuccess('expenses.saved'));

        load();
        return true;
      } catch (e) {
        dispatch(showError(e));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [dispatch, load, run],
  );

  const togglePaid = useCallback(
    async (expense: SupplierExpense) => {
      try {
        await setExpensePaid(expense.id, !expense.paid);
        load();
      } catch (e) {
        dispatch(showError(e));
      }
    },
    [dispatch, load],
  );

  const remove = useCallback(
    async (expense: SupplierExpense) => {
      const ok = await confirm({
        /* Says what will NOT happen, which is the part that matters: the
           provider's own record stays, and deleting here does not undo it. */
        bodyKey: expense.providerExpenseId
          ? 'expenses.confirmDeleteSynced'
          : 'expenses.confirmDelete',
        danger: true,
      });
      if (!ok) return;
      try {
        await deleteExpense(expense.id);
        dispatch(showSuccess('expenses.deleted'));
        load();
      } catch (e) {
        dispatch(showError(e));
      }
    },
    [confirm, dispatch, load],
  );

  const totals = useMemo(
    () => ({
      total: rows.reduce((s, e) => s + e.total, 0),
      unpaid: rows.filter((e) => !e.paid).reduce((s, e) => s + e.total, 0),
    }),
    [rows],
  );

  /* The cards count every expense, not the filtered ones: they answer "what
     do we owe", which a search box should not change. */
  return {
    rows, shown, suppliers, usedCategories, busy, totals,
    filters, setFilters,
    filtered: (Object.keys(NO_FILTERS) as (keyof ExpenseFilters)[]).some((k) => filters[k] !== NO_FILTERS[k]),
    create, togglePaid, remove,
  };
}
