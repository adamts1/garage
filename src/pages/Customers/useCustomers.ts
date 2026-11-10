import {
  CUSTOMER_KINDS, PRIVATE_CUSTOMER,
  createCustomer, customerByPhone, customerHoldingIdNumber, customersWithPhone, deleteCustomer, getCustomer,
  nameAndPhoneHolder, phoneDigits, searchCustomers, subscribeToTable, updateCustomer,
  type Customer, type Vehicle,
} from '@garage/shared';
import { useCallback, useMemo } from 'react';
import { useBurstReload, useServerPage } from '../../lib/useServerPage';
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

const onCustomersOrCars = (onChange: () => void) => {
  const offCustomers = subscribeToTable('customers', onChange);
  const offVehicles = subscribeToTable('vehicles', onChange);
  return () => { offCustomers(); offVehicles(); };
};

/** The customers screen: one page of customers matching `query`, searched by
 *  the database, and the writes that go with it.
 *
 *  It used to load every customer and every car link and filter them here —
 *  capped at 1000 rows each by PostgREST, so most of a large garage was
 *  missing, and every visit moved the whole table. */
export function useCustomers(query = '') {
  const dispatch = useAppDispatch();
  const confirm = useConfirm();
  const list = useServerPage(searchCustomers, query);
  const { rows, reload } = list;

  // Another tab — or the ticket intake form — adds a customer or a car; it shows here.
  useBurstReload(onCustomersOrCars, reload);

  /** Each customer's cars, from the page that brought the customer. */
  const vehiclesByCustomer = useMemo(
    () => new Map<string, Vehicle[]>(rows.map((c) => [c.id, c.vehicles ?? []])),
    [rows],
  );

  /* A ת״ז is unique per garage — `customers_garage_id_number_key`. Left to the
     database, a second holder comes back as a constraint name, which says
     nothing about which customer to go and look at. Asked here first, it names
     them. Asked of the database, not of the page on screen, which holds 50. */
  const idTaken = useCallback(
    async (draft: CustomerDraft, ownerId?: string) => {
      const wanted = draft.id_number?.trim();
      if (!wanted) return false;
      const holder = await customerHoldingIdNumber(wanted, ownerId);
      if (holder) dispatch(showErrorKey('customers.idTaken', { name: holder.name }));
      return Boolean(holder);
    },
    [dispatch],
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
      const holders = await customersWithPhone(draft.phone);
      const twin = nameAndPhoneHolder(holders, { phone: draft.phone, name: draft.name, exceptId: owner?.id });
      if (twin) {
        dispatch(showErrorKey('customers.namePhoneTaken', { name: twin.name }));
        return false;
      }
      if (owner && phoneDigits(owner.phone) === phoneDigits(draft.phone)) return true;
      const sharer = customerByPhone(holders.filter((c) => c.id !== owner?.id), draft.phone);
      if (!sharer) return true;
      return confirm({ bodyKey: 'customers.phoneTakenConfirm', values: { name: sharer.name } });
    },
    [confirm, dispatch],
  );

  const create = useCallback(
    async (draft: CustomerDraft) => {
      if (!draft.name.trim()) return false;
      try {
        if (await idTaken(draft)) return false;
        if (!(await nameAndPhoneOk(draft))) return false;
        await createCustomer(toRow(draft));
        dispatch(showSuccess('customers.created'));
        void reload();
        return true;
      } catch (e) {
        dispatch(showError(e));
        return false;
      }
    },
    [dispatch, idTaken, nameAndPhoneOk, reload],
  );

  const update = useCallback(
    async (id: string, draft: CustomerDraft) => {
      try {
        if (await idTaken(draft, id)) return false;
        // The record as it stands — off the page if need be, so "keeping their
        // own name and phone" is never mistaken for taking somebody else's.
        const owner = rows.find((c) => c.id === id) ?? (await getCustomer(id)) ?? undefined;
        if (!(await nameAndPhoneOk(draft, owner))) return false;
        await updateCustomer(id, toRow(draft));
        dispatch(showSuccess('customers.updated'));
        void reload();
        return true;
      } catch (e) {
        dispatch(showError(e));
        return false;
      }
    },
    [dispatch, idTaken, nameAndPhoneOk, reload, rows],
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
        void reload();
      } catch (e) {
        dispatch(showError(e));
      }
    },
    [confirm, dispatch, reload],
  );

  return { ...list, vehiclesByCustomer, create, update, remove };
}
