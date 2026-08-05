// @vitest-environment jsdom
import type { Customer } from '@garage/shared';
import { configureStore } from '@reduxjs/toolkit';
import { act, cleanup, render } from '@testing-library/react';
import { Provider } from 'react-redux';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/* The customers screen types a ת״ז straight into the table, and wrote it
   without ever asking whether somebody else already had it. The column carries
   a unique index per garage, so the database refused the write — by name:
   "duplicate key value violates unique constraint customers_garage_id_number_key",
   which tells the person at the desk nothing about which customer to go and
   look at.

   The rule is the same one the ticket page and the intake form now follow: ask
   first, and name the holder. */

const createCustomer = vi.fn();
const updateCustomer = vi.fn();
const listCustomers = vi.fn();

vi.mock('@garage/shared', async (importActual) => {
  const actual = await importActual<typeof import('@garage/shared')>();
  return {
    ...actual,
    listCustomers: (...a: unknown[]) => listCustomers(...a),
    listVehicles: vi.fn(async () => []),
    createCustomer: (...a: unknown[]) => createCustomer(...a),
    updateCustomer: (...a: unknown[]) => updateCustomer(...a),
    subscribeToTable: vi.fn(() => () => {}),
  };
});

await import('../../i18n');
const { useCustomers, blankCustomer } = await import('./useCustomers');
const { default: modal } = await import('../../store/modalSlice');
const { default: toast } = await import('../../store/toastSlice');

const customer = (over: Partial<Customer>): Customer =>
  ({
    id: 'x', name: 'x', phone: null, email: null, address: null, city: null,
    kind: 'פרטי', id_number: null, ...over,
  });

const YOSSI = customer({ id: 'yossi', name: 'יוסי לוי', id_number: '311111111' });
const DANA = customer({ id: 'dana', name: 'דנה כהן' });

/** Drives the hook the page uses, with the store the toasts land in. */
const mount = async () => {
  const store = configureStore({ reducer: { toast, modal } });
  let hook!: ReturnType<typeof useCustomers>;
  function Probe() {
    hook = useCustomers();
    return null;
  }
  render(<Provider store={store}><Probe /></Provider>);
  await act(async () => { await Promise.resolve(); });

  const toastKeys = () => store.getState().toast.items.map((x) => x.key ?? x.text);
  return { hook: () => hook, toastKeys };
};

beforeEach(() => {
  listCustomers.mockReset().mockResolvedValue([YOSSI, DANA]);
  createCustomer.mockReset().mockResolvedValue(undefined);
  updateCustomer.mockReset().mockResolvedValue(undefined);
});

afterEach(cleanup);

describe('a ת״ז on the customers screen', () => {
  it('refuses to give one customer a number another already holds', async () => {
    const { hook, toastKeys } = await mount();
    let saved: boolean | undefined;
    await act(async () => {
      saved = await hook().update('dana', { ...blankCustomer, name: 'דנה כהן', id_number: '311111111' });
    });

    expect(saved).toBe(false);
    expect(updateCustomer).not.toHaveBeenCalled();
    expect(toastKeys()).toContain('customers.idTaken');
  });

  it('refuses the same on a new customer', async () => {
    const { hook } = await mount();
    await act(async () => {
      await hook().create({ ...blankCustomer, name: 'לקוח חדש', id_number: '311111111' });
    });

    expect(createCustomer).not.toHaveBeenCalled();
  });

  it('lets a customer keep their own number', async () => {
    const { hook } = await mount();
    await act(async () => {
      await hook().update('yossi', { ...blankCustomer, name: 'יוסי לוי', id_number: '311111111' });
    });

    expect(updateCustomer).toHaveBeenCalled();
  });

  it('lets a free number through', async () => {
    const { hook } = await mount();
    await act(async () => {
      await hook().update('dana', { ...blankCustomer, name: 'דנה כהן', id_number: '322222222' });
    });

    expect(updateCustomer).toHaveBeenCalledWith('dana', expect.objectContaining({ id_number: '322222222' }));
  });
});
