// @vitest-environment jsdom
import type { Customer } from '@garage/shared';
import { configureStore } from '@reduxjs/toolkit';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const customer = (over: Partial<Customer>): Customer =>
  ({ id: 'x', name: 'x', phone: null, email: null, address: null, city: null, kind: 'private', id_number: null, ...over });

/* The search is the database's now (search_customers); the fake answers it
   with the same rules over these two customers. What is pinned here is that
   what is typed is what gets asked, and what comes back is what is shown. */
const searchCustomers = vi.fn();

vi.mock('../../lib/supabase', () => ({ isConfigured: true }));
vi.mock('@garage/shared', async (importActual) => {
  const actual = await importActual<typeof import('@garage/shared')>();
  return {
    ...actual,
    searchCustomers: (...a: unknown[]) => searchCustomers(...a),
    subscribeToTable: vi.fn(() => () => {}),
  };
});

const { fakeCustomerDb } = await import('../../test/fakeCustomerDb');
const db = fakeCustomerDb(
  () => [
    customer({ id: 'a', name: 'משה כהן', phone: '050-1234567', city: 'חיפה' }),
    customer({ id: 'b', name: 'שרה לוי', phone: '0529999999', id_number: '311111111' }),
  ],
  () => [{ id: 'v', customer_id: 'b', plate: '88-765-43' } as never],
);
searchCustomers.mockImplementation(db.searchCustomers);

await import('../../i18n');
const { default: CustomersPage } = await import('./CustomersPage');
const { default: modal } = await import('../../store/modalSlice');
const { default: toast } = await import('../../store/toastSlice');

afterEach(cleanup);

const mount = async () => {
  const store = configureStore({ reducer: { toast, modal } });
  render(<Provider store={store}><MemoryRouter><CustomersPage tickets={[]} /></MemoryRouter></Provider>);
  await screen.findByText('משה כהן');
  return screen.getByRole('textbox', { name: 'חיפוש לפי שם, טלפון, ת״ז, עיר או מספר רישוי' });
};

/** Type, and wait for the (debounced) question to reach the server. */
const search = async (box: HTMLElement, value: string) => {
  await act(async () => { fireEvent.change(box, { target: { value } }); });
  await waitFor(() => expect(searchCustomers).toHaveBeenLastCalledWith(expect.objectContaining({ query: value })));
};

describe('the customers search bar', () => {
  it.each([
    ['a name', 'משה', 'משה כהן', 'שרה לוי'],
    ['a phone typed without hyphens', '0501234', 'משה כהן', 'שרה לוי'],
    ['a ת״ז', '3111', 'שרה לוי', 'משה כהן'],
    ['a city', 'חיפה', 'משה כהן', 'שרה לוי'],
    ['the plate of one of their cars', '8876543', 'שרה לוי', 'משה כהן'],
  ])('finds by %s', async (_, value, found, hidden) => {
    const box = await mount();
    await search(box, value);
    await waitFor(() => expect(screen.queryByText(hidden)).toBeNull());
    expect(screen.queryByText(found)).not.toBeNull();
  });

  it('says so when nothing matches', async () => {
    const box = await mount();
    await search(box, 'אין כזה');
    expect(await screen.findByText('לא נמצא לקוח תואם')).not.toBeNull();
  });
});
