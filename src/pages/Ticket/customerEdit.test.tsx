// @vitest-environment jsdom
import type { Customer, Ticket } from '@garage/shared';
import { configureStore } from '@reduxjs/toolkit';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/* The customer on an open ticket.

   Two different acts that look alike on the screen. Correcting the details —
   a typo in the name, a new phone — is a correction of the customer, so it
   reaches the customer record as well as this ticket. Moving the ticket to a
   different person changes which record it belongs to and leaves both records
   alone. Once billed, neither: the invoice was printed with this customer. */

const listCustomers = vi.fn();
const updateCustomer = vi.fn();
const customerHoldingIdNumber = vi.fn();
const createCustomer = vi.fn();
const listInvoices = vi.fn();

vi.mock('@garage/shared', async (importActual) => {
  const actual = await importActual<typeof import('@garage/shared')>();
  return {
    ...actual,
    listTicketPhotos: vi.fn(async () => []),
    subscribeToTicketPhotos: vi.fn(() => () => {}),
    listWorkDefs: vi.fn(async () => []),
    listItems: vi.fn(async () => []),
    listInvoices: (...a: unknown[]) => listInvoices(...a),
    listVehicles: vi.fn(async () => []),
    createCustomer: (...a: unknown[]) => createCustomer(...a),
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
      <MemoryRouter>
        <CatalogProvider>
          <TicketPage
            ticket={t}
            setTickets={setTickets}
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
  createCustomer.mockReset();
  listInvoices.mockReset().mockResolvedValue([]);
});

afterEach(cleanup);

const field = (label: string) => screen.getAllByLabelText(label)[0] as HTMLInputElement;

describe('correcting the customer on a ticket', () => {
  it('saves the correction onto the ticket and onto the customer record', async () => {
    const { type, press, written } = await renderPage();
    await type(field('שם'), 'דנה כהן-לוי');
    await type(field('טלפון'), '0509999999');
    await press('שמור');

    expect(updateCustomer).toHaveBeenCalledWith(DANA_ID, { name: 'דנה כהן-לוי', phone: '0509999999' });
    expect(written().customer).toBe('דנה כהן-לוי');
    expect(written().customerId).toBe(DANA_ID);
  });

  it('puts the address line on the street and clears the city, so it is not printed twice', async () => {
    const { type, press } = await renderPage();
    await type(field('כתובת'), 'הרצל 5, חיפה');
    await press('שמור');

    expect(updateCustomer).toHaveBeenCalledWith(DANA_ID, { address: 'הרצל 5, חיפה', city: null });
  });

  it('refuses an empty name and touches neither table', async () => {
    const { type, press, setTickets } = await renderPage();
    await type(field('שם'), '  ');
    await press('שמור');

    expect(updateCustomer).not.toHaveBeenCalled();
    expect(setTickets).not.toHaveBeenCalled();
  });

  it('is frozen once the ticket is billed', async () => {
    listInvoices.mockResolvedValue([{
      id: 'inv-1', ticketKey: 'GAR-7', docType: 'invoice_receipt', status: 'issued', total: 100,
    }]);
    await renderPage();
    await act(async () => { await Promise.resolve(); });

    expect(field('שם').disabled).toBe(true);
    expect(screen.queryByText('העברה ללקוח אחר')).toBeNull();
  });
});

describe('moving a ticket to another customer', () => {
  it('moves it to the one picked and leaves both customer records alone', async () => {
    const { type, press, written } = await renderPage();
    await press('העברה ללקוח אחר');
    await type(screen.getByLabelText('חיפוש לפי שם, טלפון או מספר רישוי'), 'יוסי');
    await press('יוסי לוי');
    await press('אישור');

    expect(written()).toMatchObject({ customerId: 'cust-yossi', customer: 'יוסי לוי', phone: '0527654321' });
    expect(updateCustomer).not.toHaveBeenCalled();
  });

  it('does not offer the customer the ticket is already on', async () => {
    const { type, press } = await renderPage();
    await press('העברה ללקוח אחר');
    await type(screen.getByLabelText('חיפוש לפי שם, טלפון או מספר רישוי'), 'דנה');

    expect(screen.getByText('לא נמצא לקוח תואם')).toBeTruthy();
  });

  it('creates a new customer from a name and a phone, then moves the ticket to them', async () => {
    createCustomer.mockResolvedValue(customer({ id: 'cust-new', name: 'רונית ברק', phone: '0541112233' }));
    const { type, press, written } = await renderPage();
    await press('העברה ללקוח אחר');
    const inputs = screen.getAllByLabelText('שם');
    await type(inputs[inputs.length - 1], 'רונית ברק');
    const phones = screen.getAllByLabelText('טלפון');
    await type(phones[phones.length - 1], '0541112233');
    await press('יצירה והעברה');
    await press('אישור');

    expect(createCustomer).toHaveBeenCalledWith(expect.objectContaining({ name: 'רונית ברק', phone: '0541112233' }));
    expect(written()).toMatchObject({ customerId: 'cust-new', customer: 'רונית ברק' });
    expect(updateCustomer).not.toHaveBeenCalled();
  });
});
