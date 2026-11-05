import {
  CUSTOMER_KINDS, PRIVATE_CUSTOMER,
  createCustomer, customerByPhone, deleteCustomer, idNumberConflict, listCustomers, listVehicles,
  nameAndPhoneHolder, phoneDigits,
  subscribeToTable, updateCustomer,
  type Customer, type Vehicle,
} from '@garage/shared';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { showError, showErrorKey, showSuccess, useAppDispatch, useConfirm } from '../../store';

export type CustomerDraft = Omit<Customer, 'id'>;

/* Re-exported so this page's own imports do not have to know where the value
   lives; the definition is in @garage/shared, beside the rest of the stored
   vocabulary the phone app shares. */
export { CUSTOMER_KINDS };

export const blankCustomer: CustomerDraft = {
  name: '', phone: '', email: '', address: '', city: '', kind: PRIVATE_CUSTOMER, id_number: '',
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

/* The way back. The form holds '' for an empty ת״ז, and the database must get
   NULL: the unique index skips only NULL, so a stored '' made every later
   customer without a ת״ז a "duplicate" of the first one. */
export const toRow = (draft: CustomerDraft): CustomerDraft => ({
  ...draft,
  id_number: draft.id_number?.trim() || null,
});

export function useCustomers() {
  const dispatch = useAppDispatch();
  const confirm = useConfirm();
  const [rows, setRows] = useState<Customer[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  /* An empty list and a list not yet loaded look the same; the customer page
     needs to tell "no such customer" from "not here yet". */
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(() => {
    listCustomers()
      .then(setRows)
      .catch((e) => dispatch(showError(e)))
      .finally(() => setLoaded(true));
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

  /* Name + phone together are one customer, and the database will not store
     them twice (20261105090000) — not even under two different ת״ז. Caught
     here so the refusal names who already has them.

     A phone on somebody else's file, under another name, is allowed: a
     household, a fleet. It is only asked about, so a mistyped digit or a
     customer entered twice under a nickname gets a second look. Only asked
     when the number is new to this record — an edit that leaves the phone
     alone does not re-ask about a sharing somebody already accepted. */
  const nameAndPhoneOk = useCallback(
    async (draft: CustomerDraft, owner?: Customer) => {
      const twin = nameAndPhoneHolder(rows, { phone: draft.phone, name: draft.name, exceptId: owner?.id });
      if (twin) {
        dispatch(showErrorKey('customers.namePhoneTaken', { name: twin.name }));
        return false;
      }
      if (owner && phoneDigits(owner.phone) === phoneDigits(draft.phone)) return true;
      const sharer = customerByPhone(rows.filter((c) => c.id !== owner?.id), draft.phone);
      if (!sharer) return true;
      return confirm({ bodyKey: 'customers.phoneTakenConfirm', values: { name: sharer.name } });
    },
    [confirm, dispatch, rows],
  );

  const create = useCallback(
    async (draft: CustomerDraft) => {
      if (!draft.name.trim()) return false;
      if (idTaken(draft)) return false;
      if (!(await nameAndPhoneOk(draft))) return false;
      try {
        await createCustomer(toRow(draft));
        dispatch(showSuccess('customers.created'));
        load();
        return true;
      } catch (e) {
        dispatch(showError(e));
        return false;
      }
    },
    [dispatch, idTaken, load, nameAndPhoneOk],
  );

  const update = useCallback(
    async (id: string, draft: CustomerDraft) => {
      if (idTaken(draft, id)) return false;
      if (!(await nameAndPhoneOk(draft, rows.find((c) => c.id === id)))) return false;
      try {
        await updateCustomer(id, toRow(draft));
        dispatch(showSuccess('customers.updated'));
        load();
        return true;
      } catch (e) {
        dispatch(showError(e));
        return false;
      }
    },
    [dispatch, idTaken, load, nameAndPhoneOk, rows],
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

  return { rows, loaded, vehiclesByCustomer, create, update, remove };
}
