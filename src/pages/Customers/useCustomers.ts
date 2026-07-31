import {
  createCustomer, deleteCustomer, listCustomers, subscribeToTable, updateCustomer,
  type Customer,
} from '@garage/shared';
import { useCallback, useEffect, useState } from 'react';
import { showError, showSuccess, useAppDispatch, useConfirm } from '../../store';

export type CustomerDraft = Omit<Customer, 'id'>;

/** The two kinds a garage bills. Stored as the Hebrew word itself, which is why
 *  they are not translation keys: the value is in the database. */
export const CUSTOMER_KINDS = ['פרטי', 'עסקי'] as const;

export const blankCustomer: CustomerDraft = {
  name: '', phone: '', email: '', address: '', city: '', kind: 'פרטי', id_number: '',
};

export const toDraft = (c: Customer): CustomerDraft => ({
  name: c.name,
  phone: c.phone ?? '',
  email: c.email ?? '',
  address: c.address ?? '',
  city: c.city ?? '',
  kind: c.kind,
  id_number: c.id_number ?? '',
});

export function useCustomers() {
  const dispatch = useAppDispatch();
  const confirm = useConfirm();
  const [rows, setRows] = useState<Customer[]>([]);

  const load = useCallback(() => {
    listCustomers().then(setRows).catch((e) => dispatch(showError(e)));
  }, [dispatch]);

  useEffect(() => {
    load();
    // Another tab — or the ticket intake form — adds a customer; it shows here.
    return subscribeToTable('customers', load);
  }, [load]);

  const create = useCallback(
    async (draft: CustomerDraft) => {
      if (!draft.name.trim()) return false;
      try {
        await createCustomer(draft);
        dispatch(showSuccess('customers.created'));
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
    async (id: string, draft: CustomerDraft) => {
      try {
        await updateCustomer(id, draft);
        dispatch(showSuccess('customers.updated'));
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
    async (customer: Customer) => {
      const ok = await confirm({
        bodyKey: 'customers.confirmDelete',
        values: { name: customer.name },
        danger: true,
      });
      if (!ok) return;
      try {
        await deleteCustomer(customer.id);
        dispatch(showSuccess('customers.deleted'));
        load();
      } catch (e) {
        dispatch(showError(e));
      }
    },
    [confirm, dispatch, load],
  );

  return { rows, create, update, remove };
}
