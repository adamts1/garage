// @vitest-environment jsdom
import type { Ticket } from '@garage/shared';
import { configureStore } from '@reduxjs/toolkit';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/supabase', () => ({ isConfigured: true }));
vi.mock('@garage/shared', async (importActual) => ({
  ...(await importActual<typeof import('@garage/shared')>()),
  listCars: vi.fn(async () => [
    { id: 'car-1', plate: '12-345-67', manufacturer: 'קיה', model: 'נירו', year: '2022', km: null, vehicle_code: null,
      owners: [{ id: 'c-a', name: 'דנה', phone: null }, { id: 'c-b', name: 'יוסי', phone: null }] },
    { id: 'car-2', plate: '98-765-43', manufacturer: 'מאזדה', model: '3', year: null, km: null, vehicle_code: null,
      owners: [{ id: 'c-c', name: 'רונית', phone: null }] },
  ]),
}));

await import('../../i18n');
const { default: CarsPage } = await import('./CarsPage');
const { default: toast } = await import('../../store/toastSlice');

const tickets = [
  { k: 'GAR-1', carId: 'car-1', createdAtISO: '2026-10-01', createdAt: '1.10.2026' },
  { k: 'GAR-2', carId: 'car-1', createdAtISO: '2026-11-01', createdAt: '1.11.2026' },
] as Ticket[];

afterEach(cleanup);

const renderPage = async () => {
  render(
    <Provider store={configureStore({ reducer: { toast } })}>
      <MemoryRouter><CarsPage tickets={tickets} /></MemoryRouter>
    </Provider>,
  );
  await act(async () => { await Promise.resolve(); });
};

describe('the vehicles screen', () => {
  it('lists one row per car with every owner and its visits', async () => {
    await renderPage();
    expect(screen.getByText('12-345-67')).toBeTruthy();
    expect(screen.getByText('דנה')).toBeTruthy();
    expect(screen.getByText('יוסי')).toBeTruthy();
    expect(screen.getByText('1.11.2026')).toBeTruthy();
  });

  it('finds a car by its plate however it is typed, or by an owner', async () => {
    await renderPage();
    const box = screen.getByLabelText('חיפוש לפי מספר רישוי, יצרן, דגם או לקוח');
    await act(async () => { fireEvent.change(box, { target: { value: '9876543' } }); });
    expect(screen.queryByText('12-345-67')).toBeNull();
    expect(screen.getByText('98-765-43')).toBeTruthy();

    await act(async () => { fireEvent.change(box, { target: { value: 'יוסי' } }); });
    expect(screen.getByText('12-345-67')).toBeTruthy();
    expect(screen.queryByText('98-765-43')).toBeNull();
  });
});
