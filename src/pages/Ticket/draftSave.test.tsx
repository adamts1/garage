// @vitest-environment jsdom
import type { Customer, Ticket } from '@garage/shared';
import { configureStore } from '@reduxjs/toolkit';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/* The ticket page holds a draft, and the draft reaches the database only when
   somebody saves it.

   This is what the page did NOT do until now: a note was written on blur, a
   price the moment it was typed, an assignment the moment it was picked. Every
   glance at "what would this cost" was a decision, and the only undo was to
   type the old number back. What is pinned here is the boundary — edits move
   nothing until save, save moves everything, and cancel puts it back.

   The ת״ז is in the same save and lands in a different table: it is a column on
   `customers`, and it is unique per garage, so a number already held by someone
   else is refused here rather than by a constraint error afterwards. */

const listCustomers = vi.fn();
const updateCustomer = vi.fn();
const customerHoldingIdNumber = vi.fn();

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
    subscribeToTable: vi.fn(() => () => {}),
    listCustomers: (...a: unknown[]) => listCustomers(...a),
    updateCustomer: (...a: unknown[]) => updateCustomer(...a),
    customerHoldingIdNumber: (...a: unknown[]) => customerHoldingIdNumber(...a),
  };
});

await import('../../i18n');
const { default: TicketPage } = await import('./TicketPage');
const { CatalogProvider } = await import('../../features/catalog');
const { ModalHost } = await import('../../components/Modal');
const { default: modal } = await import('../../store/modalSlice');
const { default: toast } = await import('../../store/toastSlice');

const DANA_ID = 'cust-dana';

const ticket = (over: Partial<Ticket> = {}): Ticket =>
  ({
    k: 'GAR-7', st: 'todo', paid: false, type: 'job', epic: 'service', prio: 'med', pts: 3,
    who: null, job: 'W-7', title: 'טיפול', plate: '12-345-67', car: 'טויוטה',
    customer: 'דנה כהן', phone: '0501234567', customerId: DANA_ID,
    amount: 0, done: 0, subtasks: [], due: '-', flags: [], works: [], notes: 'ישן',
    ...over,
  }) as Ticket;

const customer = (over: Partial<Customer>): Customer =>
  ({
    id: 'x', name: 'x', phone: null, email: null, address: null, city: null,
    kind: 'פרטי', id_number: null, ...over,
  });

const DANA = customer({ id: DANA_ID, name: 'דנה כהן', phone: '0501234567' });
const YOSSI = customer({ id: 'cust-yossi', name: 'יוסי לוי', phone: '0527654321', id_number: '311111111' });

const renderPage = async (t: Ticket = ticket()) => {
  const store = configureStore({ reducer: { toast, modal } });
  const setTickets = vi.fn();
  render(
    <Provider store={store}>
      <CatalogProvider>
        <TicketPage
          ticket={t}
          setTickets={setTickets}
          workers={[]}
          workerChips={{} as never}
          onBack={() => {}}
        />
        <ModalHost />
      </CatalogProvider>
    </Provider>,
  );
  await act(async () => { await Promise.resolve(); });

  const notes = screen.getByPlaceholderText(/הוסף הערה/) as HTMLTextAreaElement;
  const idField = screen.getByLabelText('ת״ז') as HTMLInputElement;
  const type = async (el: HTMLElement, value: string) => {
    await act(async () => { fireEvent.change(el, { target: { value } }); });
  };
  const press = async (label: string | RegExp) => {
    await act(async () => { screen.getByText(label).click(); });
    await act(async () => { await Promise.resolve(); });
  };
  const written = (): Ticket => {
    const calls = setTickets.mock.calls;
    const update = calls[calls.length - 1][0] as (prev: Ticket[]) => Ticket[];
    return update([t])[0];
  };

  const toasts = () => store.getState().toast.items.map((x: { text?: string; key?: string }) => x.text ?? x.key);

  return { notes, idField, type, press, setTickets, written, store, toasts };
};

beforeEach(() => {
  listCustomers.mockReset().mockResolvedValue([DANA, YOSSI]);
  updateCustomer.mockReset().mockResolvedValue(undefined);
  customerHoldingIdNumber.mockReset().mockResolvedValue(null);
});

afterEach(cleanup);

describe('editing a ticket', () => {
  it('writes nothing while a note is being typed', async () => {
    const { notes, type, setTickets } = await renderPage();
    await type(notes, 'הלקוח ביקש לבדוק גם את הבלמים');

    expect(notes.value).toBe('הלקוח ביקש לבדוק גם את הבלמים');
    expect(setTickets).not.toHaveBeenCalled();
  });

  it('writes the whole draft on save', async () => {
    const { notes, type, press, written } = await renderPage();
    await type(notes, 'חדש');
    await press('שמור');

    expect(written().notes).toBe('חדש');
  });

  it('puts the ticket back when the edit is cancelled', async () => {
    const { notes, type, press, setTickets } = await renderPage();
    await type(notes, 'טעות');
    await press('בטל שינויים');

    expect(notes.value).toBe('ישן');
    expect(setTickets).not.toHaveBeenCalled();
  });
});

describe('the ת״ז on a ticket', () => {
  it('shows what the customer record holds', async () => {
    listCustomers.mockResolvedValue([customer({ ...DANA, id_number: '312345678' }), YOSSI]);
    const { idField } = await renderPage();

    expect(idField.value).toBe('312345678');
  });

  it('saves a new one onto the customer, not the ticket', async () => {
    const { idField, type, press } = await renderPage();
    await type(idField, '312345678');
    await press('שמור');

    expect(updateCustomer).toHaveBeenCalledWith(DANA_ID, { id_number: '312345678' });
  });

  it('warns when the number already belongs to somebody else', async () => {
    const { idField, type } = await renderPage();
    await type(idField, '311111111');   // יוסי לוי holds this one

    expect(screen.getByText(/יוסי לוי/)).toBeTruthy();
  });

  it('refuses to save a ת״ז held by another customer — neither table is touched', async () => {
    const { idField, type, press, setTickets } = await renderPage();
    await type(idField, '311111111');
    await press('שמור');

    expect(updateCustomer).not.toHaveBeenCalled();
    expect(setTickets).not.toHaveBeenCalled();
  });

  /* The list on this screen was loaded when it opened. A customer entered at
     another counter since is not in it, so the in-memory check cannot see the
     clash and the database is the one that knows. */
  it('refuses a number the database says is taken, even when the page cannot see it', async () => {
    customerHoldingIdNumber.mockResolvedValue({ ...YOSSI, id_number: '399999999' });
    const { idField, type, press, toasts, setTickets } = await renderPage();

    await type(idField, '399999999');   // nobody in the loaded list holds this
    expect(screen.queryByText(/יוסי לוי/)).toBeNull();

    await press('שמור');

    expect(updateCustomer).not.toHaveBeenCalled();
    expect(setTickets).not.toHaveBeenCalled();
    // Named, in Hebrew — not "[object Object]", and not a constraint name.
    expect(toasts().join(' ')).toContain('ticket.idTakenBlocked');
  });

  it('cannot be edited on a ticket with no customer record', async () => {
    listCustomers.mockResolvedValue([]);
    const { idField } = await renderPage();

    expect(idField.disabled).toBe(true);
  });
});
