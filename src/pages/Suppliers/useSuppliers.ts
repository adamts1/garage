import {
  createSupplier, deleteSupplier, listSuppliers, subscribeToExpenses, updateSupplier,
  type Supplier,
} from '@garage/shared';
import { useCallback, useEffect, useState } from 'react';
import { showError, showErrorKey, showSuccess, useAppDispatch, useConfirm } from '../../store';

export interface SupplierDraft {
  name: string;
  taxId: string;
  phone: string;
  email: string;
  address: string;
  notes: string;
}

export const blankSupplier: SupplierDraft = {
  name: '', taxId: '', phone: '', email: '', address: '', notes: '',
};

export const toDraft = (s: Supplier): SupplierDraft => ({
  name: s.name,
  taxId: s.taxId ?? '',
  phone: s.phone ?? '',
  email: s.email ?? '',
  address: s.address ?? '',
  notes: s.notes ?? '',
});

/** Postgres foreign-key violation. The only delete failure with a better
 *  explanation than the driver's own. */
const FK_VIOLATION = '23503';

const isFkViolation = (e: unknown) =>
  typeof e === 'object' && e !== null && (e as { code?: string }).code === FK_VIOLATION;

/** Everything the page does that is not rendering. The view below is then a
 *  function of `rows` and nothing else, which is what makes it readable. */
export function useSuppliers() {
  const dispatch = useAppDispatch();
  const confirm = useConfirm();
  const [rows, setRows] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    listSuppliers()
      .then(setRows)
      .catch((e) => dispatch(showError(e)))
      .finally(() => setLoading(false));
  }, [dispatch]);

  useEffect(() => {
    load();
    // A supplier can also appear from the iCount sync, not just from this page.
    return subscribeToExpenses(load);
  }, [load]);

  const create = useCallback(
    async (draft: SupplierDraft) => {
      if (!draft.name.trim()) return false;
      try {
        await createSupplier(draft);
        dispatch(showSuccess('suppliers.created'));
        load();
        return true;
      } catch (e) {
        dispatch(showError(e));
        return false;
      }
    },
    [dispatch, load],
  );

  const update = useCallback(
    async (id: string, draft: SupplierDraft) => {
      try {
        await updateSupplier(id, draft);
        dispatch(showSuccess('suppliers.updated'));
        load();
        return true;
      } catch (e) {
        dispatch(showError(e));
        return false;
      }
    },
    [dispatch, load],
  );

  const remove = useCallback(
    async (supplier: Supplier) => {
      const ok = await confirm({
        bodyKey: 'suppliers.confirmDelete',
        name: supplier.name,
        danger: true,
      });
      if (!ok) return;

      try {
        await deleteSupplier(supplier.id);
        dispatch(showSuccess('suppliers.deleted'));
        load();
      } catch (e) {
        /* The old page answered every delete failure with "has expenses". That
           is true of one error code and a lie about the rest — a dropped
           connection reported itself as a books problem. Explain the case we
           understand; show the driver's own words for the ones we do not. */
        dispatch(isFkViolation(e) ? showErrorKey('suppliers.deleteBlocked') : showError(e));
      }
    },
    [confirm, dispatch, load],
  );

  return { rows, loading, create, update, remove };
}
