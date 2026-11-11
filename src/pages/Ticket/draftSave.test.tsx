// @vitest-environment jsdom
import type { Customer, Ticket } from '@garage/shared';
import { configureStore } from '@reduxjs/toolkit';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
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

/* The customers on file, as the database holds them. The page asks for this
   ticket's record, for who holds a ת״ז being typed, and (switching) searches. */
let onFile: Customer[] = [];
const searchCustomers = vi.fn();
const getCustomer = vi.fn();
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
    searchCustomers: (...a: unknown[]) => searchCustomers(...a),
    getCustomer: (...a: unknown[]) => getCustomer(...a),
    updateCustomer: (...a: unknown[]) => updateCustomer(...a),
    customerHoldingIdNumber: (...a: unknown[]) => customerHoldingIdNumber(...a),
  };
});

vi.mock('../../lib/supabase', () => ({ isConfigured: true }));

const { fakeCustomerDb } = await import('../../test/fakeCustomerDb');
const db = fakeCustomerDb(() => onFile);

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
  const saveTicket = vi.fn(async (_: Ticket) => {});
  render(
    <Provider store={store}>
      <MemoryRouter>
        <CatalogProvider>
          <TicketPage
            ticket={t}
            saveTicket={saveTicket}
            workers={[]}
            workerChips={{} as never}
            onBack={() => {}}
            onCancelTicket={async () => {}}
          />
          <ModalHost />
        </CatalogProvider>
      </MemoryRouter>
    </Provider>,
  );
  // The customer record arrives from the database after the first paint.
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

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
    const calls = saveTicket.mock.calls;
    return calls[calls.length - 1][0];
  };

  const toasts = () => store.getState().toast.items.map((x: { text?: string; key?: string }) => x.text ?? x.key);

  return { notes, idField, type, press, saveTicket, written, store, toasts };
};

beforeEach(() => {
  onFile = [DANA, YOSSI];
  searchCustomers.mockReset().mockImplementation(db.searchCustomers);
  getCustomer.mockReset().mockImplementation(db.getCustomer);
  updateCustomer.mockReset().mockResolvedValue(undefined);
  customerHoldingIdNumber.mockReset().mockImplementation(db.customerHoldingIdNumber);
});

afterEach(cleanup);

describe('editing a ticket', () => {
  it('writes nothing while a note is being typed', async () => {
    const { notes, type, saveTicket } = await renderPage();
    await type(notes, 'הלקוח ביקש לבדוק גם את הבלמים');

    expect(notes.value).toBe('הלקוח ביקש לבדוק גם את הבלמים');
    expect(saveTicket).not.toHaveBeenCalled();
  });

  it('writes the whole draft on save', async () => {
    const { notes, type, press, written } = await renderPage();
    await type(notes, 'חדש');
    await press('שמור');

    expect(written().notes).toBe('חדש');
  });

  it('puts the ticket back when the edit is cancelled', async () => {
    const { notes, type, press, saveTicket } = await renderPage();
    await type(notes, 'טעות');
    await press('בטל שינויים');

    expect(notes.value).toBe('ישן');
    expect(saveTicket).not.toHaveBeenCalled();
  });
});

describe('the ת״ז on a ticket', () => {
  it('shows what the customer record holds', async () => {
    onFile = [customer({ ...DANA, id_number: '312345678' }), YOSSI];
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

    // Asked of the database once typing pauses.
    expect(await screen.findByText(/יוסי לוי/)).toBeTruthy();
  });

  it('refuses to save a ת״ז held by another customer — neither table is touched', async () => {
    const { idField, type, press, saveTicket } = await renderPage();
    await type(idField, '311111111');
    await press('שמור');

    expect(updateCustomer).not.toHaveBeenCalled();
    expect(saveTicket).not.toHaveBeenCalled();
  });

  /* The warning is asked once typing pauses; a save pressed before it arrives
     must still be refused — the save asks the database again itself. */
  it('refuses a number the database says is taken, even when the page cannot see it', async () => {
    customerHoldingIdNumber.mockResolvedValue({ ...YOSSI, id_number: '399999999' });
    const { idField, type, press, toasts, saveTicket } = await renderPage();

    await type(idField, '399999999');   // saved at once, before the warning's question is sent
    expect(screen.queryByText(/יוסי לוי/)).toBeNull();

    await press('שמור');

    expect(updateCustomer).not.toHaveBeenCalled();
    expect(saveTicket).not.toHaveBeenCalled();
    // Named, in Hebrew — not "[object Object]", and not a constraint name.
    expect(toasts().join(' ')).toContain('ticket.idTakenBlocked');
  });

  it('cannot be edited on a ticket with no customer record', async () => {
    onFile = [];
    const { idField } = await renderPage();

    expect(idField.disabled).toBe(true);
  });
});
