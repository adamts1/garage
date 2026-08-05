// @vitest-environment jsdom
import type { Ticket, Worker } from '@garage/shared';
import { configureStore } from '@reduxjs/toolkit';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { afterEach, describe, expect, it, vi } from 'vitest';

/* Assigning a ticket to a worker.

   The field has always existed on the row — `assignee`, resolved through
   workerChip — and the web app had no control that wrote it. What is pinned
   here is that the picker writes the worker's CODE (what the foreign key
   points at, not the name), that "nobody" writes NULL rather than '', and that
   a ticket already held by a retired worker keeps them: they are gone from the
   list of people you may choose, which would otherwise make merely opening the
   menu rewrite the ticket. */

vi.mock('@garage/shared', async (importActual) => {
  const actual = await importActual<typeof import('@garage/shared')>();
  return {
    ...actual,
    listTicketPhotos: vi.fn(async () => []),
    subscribeToTicketPhotos: vi.fn(() => () => {}),
    listWorkDefs: vi.fn(async () => []),
    listItems: vi.fn(async () => []),
    listInvoices: vi.fn(async () => []),
    subscribeToInvoices: vi.fn(() => () => {}),
    listCustomers: vi.fn(async () => []),
    updateCustomer: vi.fn(async () => {}),
    subscribeToTable: vi.fn(() => () => {}),
  };
});

await import('../../i18n');
const { default: TicketPage } = await import('./TicketPage');
const { CatalogProvider } = await import('../../features/catalog');
const { default: modal } = await import('../../store/modalSlice');
const { default: toast } = await import('../../store/toastSlice');

const ticket = (over: Partial<Ticket> = {}): Ticket =>
  ({
    k: 'GAR-7', st: 'prog', paid: false, type: 'job', epic: 'service', prio: 'med', pts: 3,
    who: null, job: 'W-7', title: 'טיפול', plate: '12-345-67', car: 'טויוטה',
    customer: 'דנה כהן', amount: 0, done: 0, subtasks: [], due: '-', flags: [], works: [],
    ...over,
  }) as Ticket;

const worker = (over: Partial<Worker>): Worker =>
  ({ id: 'x', code: 'x', name: 'x', initials: 'XX', color: '#3e5c76', position: 1, active: true, userId: null, ...over });

const STAFF = [
  worker({ id: '1', code: 'dani', name: 'דני כהן', initials: 'דכ', position: 1 }),
  worker({ id: '2', code: 'noa', name: 'נועה שמש', initials: 'נש', position: 2 }),
  worker({ id: '3', code: 'avi', name: 'אבי מזרחי', initials: 'אמ', position: 3, active: false }),
];

const CHIPS = Object.fromEntries(
  STAFF.map((w) => [w.code, { n: w.name, ini: w.initials, bg: w.color }]),
);

/** Renders the page and hands back whatever the picker writes to the ticket. */
const renderPage = async (t: Ticket = ticket()) => {
  const store = configureStore({ reducer: { toast, modal } });
  const setTickets = vi.fn();
  render(
    <Provider store={store}>
      <CatalogProvider>
        <TicketPage
          ticket={t}
          setTickets={setTickets}
          workers={STAFF}
          workerChips={CHIPS}
          onBack={() => {}}
        />
      </CatalogProvider>
    </Provider>,
  );
  await act(async () => { await Promise.resolve(); });

  const picker = screen.getByLabelText('שיוך העובד האחראי') as HTMLSelectElement;

  /** Nothing on this page writes until somebody presses save. */
  const pressSave = async () => {
    await act(async () => { screen.getByText('שמור').click(); });
  };

  /** The ticket as it stands after the picker's write — setTickets is handed an
   *  updater, so this applies it the way useTickets would. */
  const written = (): Ticket => {
    const calls = setTickets.mock.calls;
    const update = calls[calls.length - 1][0] as (prev: Ticket[]) => Ticket[];
    return update([t])[0];
  };

  return { picker, setTickets, written, pressSave };
};

afterEach(cleanup);

describe('assigning a ticket', () => {
  it('offers the active staff, and nobody, but not a retired worker', async () => {
    const { picker } = await renderPage();
    const options = [...picker.options].map((o) => o.textContent);

    expect(options).toEqual(['ללא עובד אחראי', 'דני כהן', 'נועה שמש']);
  });

  it('changes nothing until the ticket is saved', async () => {
    const { picker, setTickets } = await renderPage();
    await act(async () => { fireEvent.change(picker, { target: { value: 'noa' } }); });

    // Picked, shown, and not yet written: the page holds a draft now.
    expect(picker.value).toBe('noa');
    expect(setTickets).not.toHaveBeenCalled();
  });

  it('writes the worker code, not the name', async () => {
    const { picker, written, pressSave } = await renderPage();
    await act(async () => { fireEvent.change(picker, { target: { value: 'noa' } }); });
    await pressSave();

    expect(written().who).toBe('noa');
  });

  it('takes the ticket off everybody as null, never as an empty code', async () => {
    const { picker, written, pressSave } = await renderPage(ticket({ who: 'dani' }));
    expect(picker.value).toBe('dani');

    await act(async () => { fireEvent.change(picker, { target: { value: '' } }); });
    await pressSave();

    expect(written().who).toBeNull();
  });

  it('keeps a retired assignee on the ticket that already has them', async () => {
    const { picker, setTickets } = await renderPage(ticket({ who: 'avi' }));

    // Shown as the current value — opening the menu must not silently reassign.
    expect(picker.value).toBe('avi');
    expect([...picker.options].map((o) => o.textContent)).toContain('אבי מזרחי (הושבת)');
    expect(setTickets).not.toHaveBeenCalled();
  });
});
