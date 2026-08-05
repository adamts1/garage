import {
  createCustomer, deleteCustomer, idNumberConflict, listCustomers, listVehicles,
  subscribeToTable, updateCustomer,
  type Customer, type Vehicle,
} from '@garage/shared';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { showError, showErrorKey, showSuccess, useAppDispatch, useConfirm } from '../../store';

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
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);

  const load = useCallback(() => {
    listCustomers().then(setRows).catch((e) => dispatch(showError(e)));
  }, [dispatch]);

  /* The cars are promoted onto a customer by create_ticket, so this list grows
     without anybody visiting this page. Failing quietly is deliberate: a
     customer table that will not render because the vehicles call failed is a
     worse outcome than a customer with no cars listed. */
  const loadVehicles = useCallback(() => {
    listVehicles().then(setVehicles).catch(() => {});
  }, []);

  useEffect(() => {
    load();
    loadVehicles();
    // Another tab — or the ticket intake form — adds a customer; it shows here.
    const offCustomers = subscribeToTable('customers', load);
    const offVehicles = subscribeToTable('vehicles', loadVehicles);
    return () => { offCustomers(); offVehicles(); };
  }, [load, loadVehicles]);

  /** Indexed once per change rather than filtered per row, so a garage with a
   *  few thousand cars does not walk the whole list for every customer. */
  const vehiclesByCustomer = useMemo(() => {
    const map = new Map<string, Vehicle[]>();
    for (const v of vehicles) {
      const list = map.get(v.customer_id);
      if (list) list.push(v);
      else map.set(v.customer_id, [v]);
    }
    return map;
  }, [vehicles]);

  /* A ת״ז is unique per garage — `customers_garage_id_number_key`. Left to the
     database, a second holder comes back as a constraint name, which says
     nothing about which customer to go and look at. Caught here, it names them.

     The list this checks is the one on screen, and it is kept live by the
     subscription above; the database still has the last word, and showError
     turns that constraint into a sentence if this is ever raced. */
  const idTaken = useCallback(
    (draft: CustomerDraft, ownerId?: string) => {
      const clash = idNumberConflict(rows, {
        idNumber: draft.id_number ?? '',
        name: draft.name,
        ownerId,
      });
      if (clash) dispatch(showErrorKey('customers.idTaken', { name: clash.customer.name }));
      return Boolean(clash);
    },
    [dispatch, rows],
  );

  const create = useCallback(
    async (draft: CustomerDraft) => {
      if (!draft.name.trim()) return false;
      if (idTaken(draft)) return false;
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
    [dispatch, idTaken, load],
  );

  const update = useCallback(
    async (id: string, draft: CustomerDraft) => {
      if (idTaken(draft, id)) return false;
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
    [dispatch, idTaken, load],
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

  return { rows, vehiclesByCustomer, create, update, remove };
}
