// @vitest-environment jsdom
import type { Customer } from '@garage/shared';
import { configureStore } from '@reduxjs/toolkit';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const customer = (over: Partial<Customer>): Customer =>
  ({ id: 'x', name: 'x', phone: null, email: null, address: null, city: null, kind: 'private', id_number: null, ...over });

vi.mock('@garage/shared', async (importActual) => {
  const actual = await importActual<typeof import('@garage/shared')>();
  return {
    ...actual,
    listCustomers: vi.fn(async () => [
      customer({ id: 'a', name: 'משה כהן', phone: '050-1234567', city: 'חיפה' }),
      customer({ id: 'b', name: 'שרה לוי', phone: '0529999999', id_number: '311111111' }),
    ]),
    listVehicles: vi.fn(async () => [{ id: 'v', customer_id: 'b', plate: '88-765-43' }]),
    subscribeToTable: vi.fn(() => () => {}),
  };
});

await import('../../i18n');
const { default: CustomersPage } = await import('./CustomersPage');
const { default: modal } = await import('../../store/modalSlice');
const { default: toast } = await import('../../store/toastSlice');

afterEach(cleanup);

const mount = async () => {
  const store = configureStore({ reducer: { toast, modal } });
  render(<Provider store={store}><MemoryRouter><CustomersPage tickets={[]} /></MemoryRouter></Provider>);
  await act(async () => { await Promise.resolve(); });
  return screen.getByRole('textbox', { name: 'חיפוש לפי שם, טלפון, ת״ז, עיר או מספר רישוי' });
};

const search = async (box: HTMLElement, value: string) => {
  await act(async () => { fireEvent.change(box, { target: { value } }); });
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
    expect(screen.queryByText(found)).not.toBeNull();
    expect(screen.queryByText(hidden)).toBeNull();
  });

  it('says so when nothing matches', async () => {
    const box = await mount();
    await search(box, 'אין כזה');
    expect(screen.queryByText('לא נמצא לקוח תואם')).not.toBeNull();
  });
});
