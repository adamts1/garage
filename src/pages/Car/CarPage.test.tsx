// @vitest-environment jsdom
import type { Ticket } from '@garage/shared';
import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

/* A car's history is every work order for its plate, whoever brought it in —
   matched on car_id, never on the customer. */

vi.mock('../../lib/supabase', () => ({ isConfigured: true }));
vi.mock('@garage/shared', async (importActual) => ({
  ...(await importActual<typeof import('@garage/shared')>()),
  getCar: vi.fn(async () => ({
    car: { id: 'car-1', plate: '12345678', manufacturer: 'קיה', model: 'נירו', year: '2022', km: '3000', vehicle_code: '4111' },
    owners: [{ id: 'c-a', name: 'דנה', phone: null }, { id: 'c-b', name: 'יוסי', phone: null }],
  })),
  listCarLegacyHistory: vi.fn(async () => [
    {
      k: 'RB-1131', st: 'done', title: 'טיפול', plate: '12345678', customer: 'דנה', amount: 0,
      carId: 'car-1', createdAtISO: '2021-04-07T08:00:00Z', legacy: { source: 'ricbi', number: '1131' },
      works: [{ uid: 'w', code: '', name: 'טיפול', labor: 0, items: [
        { sku: '90915-YZZE1', name: 'מסנן שמן מקורי', qty: 1, price: 70 },
      ] }],
    },
  ]),
}));

await import('../../i18n');
const { default: CarPage } = await import('./CarPage');

const { fireEvent } = await import('@testing-library/react');

const ticket = (k: string, over: Partial<Ticket>): Ticket =>
  ({ k, st: 'paid', title: 'טיפול', plate: '12345678', customer: '', amount: 0, ...over }) as Ticket;

afterEach(cleanup);

describe('the car page', () => {
  it("lists every owner's work orders for the car, and nobody else's", async () => {
    const tickets = [
      ticket('GAR-8', { carId: 'car-1', customer: 'דנה', km: '1000' }),
      ticket('GAR-46', { carId: 'car-1', customer: 'יוסי', km: '2000' }),
      ticket('GAR-9', { carId: 'car-2', customer: 'דנה' }),
    ];
    render(
      <MemoryRouter initialEntries={['/cars/car-1']}>
        <Routes><Route path="/cars/:id" element={<CarPage tickets={tickets} onOpenTicket={() => {}} />} /></Routes>
      </MemoryRouter>,
    );
    await act(async () => { await Promise.resolve(); });

    expect(screen.getByText('GAR-8')).toBeTruthy();
    expect(screen.getByText('GAR-46')).toBeTruthy();
    expect(screen.queryByText('GAR-9')).toBeNull();
    // Both owners, each a link to their record.
    expect(screen.getAllByText('דנה').length).toBeGreaterThan(0);
    expect(screen.getAllByText('יוסי').length).toBeGreaterThan(0);
    expect(screen.getByText('4111')).toBeTruthy();
  });

  it('adds the previous system\'s work orders, and opens one like any ticket', async () => {
    const onOpenTicket = vi.fn();
    render(
      <MemoryRouter initialEntries={['/cars/car-1']}>
        <Routes><Route path="/cars/:id" element={<CarPage tickets={[]} onOpenTicket={onOpenTicket} />} /></Routes>
      </MemoryRouter>,
    );
    await act(async () => { await Promise.resolve(); });

    expect(screen.getByText('RB-1131')).toBeTruthy();
    expect(screen.getByText('מערכת קודמת')).toBeTruthy();
    // Opened by its key; the ticket route shows an imported card read-only.
    fireEvent.click(screen.getByText('RB-1131'));
    expect(onOpenTicket).toHaveBeenCalledWith('RB-1131');
  });
});
