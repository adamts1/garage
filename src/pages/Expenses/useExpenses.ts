import {
  createExpense, deleteExpense, listExpenses, listSuppliers, setExpensePaid,
  subscribeToExpenses, syncExpense,
  type Supplier, type SupplierExpense,
} from '@garage/shared';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { showError, showErrorKey, showSuccess, useAppDispatch, useBusyRun, useConfirm } from '../../store';

export interface ExpenseDraft {
  supplierId: string;
  date: string;
  description: string;
  category: string;
  reference: string;
  subtotal: string;
  vatRate: string;
  paid: boolean;
  /** Blank means on receipt — see dueOn() in @garage/shared. */
  dueDate: string;
  chequeNumber: string;
  chequeDate: string;
}

export const today = () => new Date().toISOString().slice(0, 10);

export const blankExpense = (): ExpenseDraft => ({
  supplierId: '', date: today(), description: '', category: '',
  reference: '', subtotal: '', vatRate: '0.18', paid: false,
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

export function useExpenses() {
  const dispatch = useAppDispatch();
  const run = useBusyRun();
  const confirm = useConfirm();
  const [rows, setRows] = useState<SupplierExpense[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [busy, setBusy] = useState(false);

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
      if (!draft.supplierId || !(Number(draft.subtotal) > 0)) return false;
      setBusy(true);
      try {
        const created = await run('busy.savingExpense', () => createExpense({
          supplierId: draft.supplierId,
          date: draft.date,
          description: draft.description,
          category: draft.category,
          reference: draft.reference,
          subtotal: Number(draft.subtotal),
          vatRate: Number(draft.vatRate),
          paid: draft.paid,
          /* Empty strings become nulls: a date input left alone is "nobody
             said", and storing '' would be a date the database has to reject. */
          dueDate: draft.dueDate || null,
          chequeNumber: draft.chequeNumber || null,
          chequeDate: draft.chequeDate || null,
        }));

        /* The record exists either way — the sync is a second, separate thing
           that can fail on its own. Reporting them as one action was how "saved
           but not synced" came to read as "not saved". */
        try {
          const synced = await run('busy.syncingExpense', () => syncExpense(created.id));
          if (synced.syncStatus === 'synced') dispatch(showSuccess('expenses.savedAndSynced'));
          else dispatch(showErrorKey('expenses.savedNotSynced', { reason: synced.syncError ?? '' }));
        } catch (e) {
          dispatch(showErrorKey('expenses.savedNotSynced', {
            reason: e instanceof Error ? e.message : String(e),
          }));
        }

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

  const retrySync = useCallback(
    async (id: string) => {
      try {
        const synced = await run('busy.syncingExpense', () => syncExpense(id));
        dispatch(
          synced.syncStatus === 'synced'
            ? showSuccess('expenses.synced')
            : showErrorKey('expenses.syncFailed', { reason: synced.syncError ?? '' }),
        );
        load();
      } catch (e) {
        dispatch(showError(e));
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
      unsynced: rows.filter((e) => e.syncStatus !== 'synced').length,
    }),
    [rows],
  );

  return { rows, suppliers, busy, totals, create, retrySync, togglePaid, remove };
}
