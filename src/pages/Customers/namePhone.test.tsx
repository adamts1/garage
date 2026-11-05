// @vitest-environment jsdom
import type { Customer } from '@garage/shared';
import { configureStore } from '@reduxjs/toolkit';
import { act, cleanup, render } from '@testing-library/react';
import { Provider } from 'react-redux';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/* Name + phone together are one customer (20261105090000): the database
   refuses a second record for them, even under another ת״ז. The customers
   screen catches it first, to name who already has them. A phone shared under
   another name is allowed, after a question. */

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
    kind: 'private', id_number: null, ...over,
  });

const MOSHE = customer({ id: 'moshe', name: 'משה כהן', phone: '050-1234567' });
const SARA = customer({ id: 'sara', name: 'שרה לוי', phone: '0529999999' });

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
  return { hook: () => hook, toastKeys, store };
};

beforeEach(() => {
  listCustomers.mockReset().mockResolvedValue([MOSHE, SARA]);
  createCustomer.mockReset().mockResolvedValue(undefined);
  updateCustomer.mockReset().mockResolvedValue(undefined);
});

afterEach(cleanup);

describe('name + phone on the customers screen', () => {
  it('refuses a new customer with a name and phone already on file, ת״ז or not', async () => {
    const { hook, toastKeys } = await mount();
    let saved: boolean | undefined;
    await act(async () => {
      saved = await hook().create({ ...blankCustomer, name: ' משה  כהן', phone: '0501234567', id_number: '123' });
    });
    expect(saved).toBe(false);
    expect(createCustomer).not.toHaveBeenCalled();
    expect(toastKeys()).toContain('customers.namePhoneTaken');
  });

  it('refuses an edit that turns one customer into another', async () => {
    const { hook, toastKeys } = await mount();
    let saved: boolean | undefined;
    await act(async () => {
      saved = await hook().update('sara', { ...blankCustomer, name: 'משה כהן', phone: '050-1234567' });
    });
    expect(saved).toBe(false);
    expect(updateCustomer).not.toHaveBeenCalled();
    expect(toastKeys()).toContain('customers.namePhoneTaken');
  });

  it('asks, and does not refuse, when the phone is shared under another name', async () => {
    const { hook, store } = await mount();
    let pending!: Promise<boolean>;
    act(() => {
      pending = hook().create({ ...blankCustomer, name: 'דני כהן', phone: '0501234567' });
    });
    await act(async () => { await Promise.resolve(); });
    expect(createCustomer).not.toHaveBeenCalled();
    expect(JSON.stringify(store.getState().modal)).toContain('customers.phoneTakenConfirm');
  });

  it('lets a customer keep their own name and phone on edit, without asking', async () => {
    const { hook } = await mount();
    let saved: boolean | undefined;
    await act(async () => {
      saved = await hook().update('moshe', { ...blankCustomer, name: 'משה כהן', phone: '050-1234567', email: 'm@x.co' });
    });
    expect(saved).toBe(true);
    expect(updateCustomer).toHaveBeenCalled();
  });
});
