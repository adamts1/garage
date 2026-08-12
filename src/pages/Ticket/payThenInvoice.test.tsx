// @vitest-environment jsdom

/* The document follows the money.
 *
 * The close-and-charge drawer has told the advisor "יופק חשבונית מס-קבלה" and
 * "המסמך יישלח ללקוח בסיום התהליך" since it was written, and for just as long
 * nothing issued anything: the ticket went to שולם and the document was a
 * separate trip back into the ticket, made from memory. A garage that collected
 * on Friday and remembered on Monday had a week of takings with no documents
 * behind them.
 *
 * What is pinned here is the join between the two, in all four of its cases —
 * paid, unpaid, no provider connected, and a provider that refuses. The last two
 * matter most: the money is already recorded by then, so neither may be allowed
 * to look like the payment failed.
 */

import type { Invoice, Ticket } from '@garage/shared';
import { configureStore } from '@reduxjs/toolkit';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { Provider } from 'react-redux';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const issueInvoice = vi.fn();
const invoicingActive = vi.fn();

vi.mock('@garage/shared', async (importActual) => {
  const actual = await importActual<typeof import('@garage/shared')>();
  return {
    ...actual,
    garageName: () => 'מוסך הבדיקה',
    listTicketPhotos: vi.fn(async () => []),
    subscribeToTicketPhotos: vi.fn(() => () => {}),
    listWorkDefs: vi.fn(async () => []),
    listItems: vi.fn(async () => []),
    listInvoices: vi.fn(async () => []),
    subscribeToInvoices: vi.fn(() => () => {}),
    listCustomers: vi.fn(async () => []),
    updateCustomer: vi.fn(async () => {}),
    subscribeToTable: vi.fn(() => () => {}),
    isGarageAdmin: () => true,
    issueInvoice: (...a: unknown[]) => issueInvoice(...a),
    invoicingActive: () => invoicingActive(),
  };
});

await import('../../i18n');
const { default: TicketPage } = await import('./TicketPage');
const { CatalogProvider } = await import('../../features/catalog');
const { ModalHost } = await import('../../components/Modal');
const { default: modal } = await import('../../store/modalSlice');
const { default: toast } = await import('../../store/toastSlice');

/* Finished but unpaid — the only state the close-and-charge button is offered
   in. A settled ticket disables it. */
const ticket = (over: Partial<Ticket> = {}): Ticket =>
  ({
    k: 'GAR-7', st: 'done', paid: false, type: 'job', epic: 'service', prio: 'med', pts: 3,
    who: null, job: 'W-7', title: 'טיפול', plate: '12-345-67', car: 'טויוטה',
    customer: 'דנה כהן', amount: 1180, done: 0, subtasks: [], due: '-', flags: [],
    works: [{ uid: 'w1', code: 'SRV', name: 'טיפול', labor: 1000, hours: 1, items: [] }],
    ...over,
  }) as Ticket;

const invoice = (): Invoice =>
  ({
    id: 'inv1', ticketKey: 'GAR-7', docType: 'invoice_receipt', status: 'issued',
    docnum: '20451', allocationNumber: null, pdfUrl: null, provider: 'icount',
    issuedAt: '2026-08-01T00:00:00Z', customerName: 'דנה כהן', lines: [],
    subtotal: 1000, vatRate: 0.18, vat: 180, total: 1180,
  }) as unknown as Invoice;

const renderPage = async () => {
  const store = configureStore({ reducer: { toast, modal } });
  render(
    <Provider store={store}>
      <CatalogProvider>
        <TicketPage
          ticket={ticket()}
          setTickets={() => {}}
          workers={[]}
          workerChips={{} as never}
          onBack={() => {}}
        />
        <ModalHost />
      </CatalogProvider>
    </Provider>,
  );
  await act(async () => { await Promise.resolve(); });
  return store;
};

/* The drawer is three steps and two timers — a stand-in for the terminal
   round-trip, and a success screen that shows before it hands its answer back.
   Both are stepped through here rather than waited on. */
const closeAndCharge = async (method: string) => {
  await act(async () => { screen.getByText(/גבה תשלום|סגור כרטיס וחייב לקוח/).click(); });

  /* Scoped to the drawer. The page underneath carries its own summary <aside>
     and its own "גבה" button, so an unscoped query matches both — and the page's
     aside comes first in the DOM. The drawer is the one the modal host appended
     last. */
  const drawer = () => {
    const asides = document.querySelectorAll('aside');
    return within(asides[asides.length - 1] as HTMLElement);
  };

  await act(async () => { drawer().getByText(method).click(); });      // step 1
  await act(async () => { drawer().getByText('המשך').click(); });      // → step 2
  await act(async () => { drawer().getByText('המשך').click(); });      // → step 3
  await act(async () => { drawer().getByText(/^גבה |^סגור כרטיס$/).click(); });
  await act(async () => { await vi.advanceTimersByTimeAsync(900); });   // "charging"
  await act(async () => { await vi.advanceTimersByTimeAsync(1500); });  // success screen
  await act(async () => { await Promise.resolve(); });
};

const toasts = (store: ReturnType<typeof configureStore>) =>
  (store.getState() as { toast: { items: Array<{ key: string }> } }).toast.items.map((x) => x.key);

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  issueInvoice.mockReset().mockResolvedValue(invoice());
  invoicingActive.mockReset().mockResolvedValue(true);
});

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('taking a payment', () => {
  it('issues the invoice-receipt, without asking a second time', async () => {
    await renderPage();
    await closeAndCharge('מזומן');

    expect(issueInvoice).toHaveBeenCalledTimes(1);
    expect(issueInvoice).toHaveBeenCalledWith('GAR-7', 'invoice_receipt');
  });

  /* The confirmation dialog belongs to the button, not to this path: the person
     has just worked through three steps of a drawer that names the document
     twice and ends on "גבה ₪1,180". Asking again would be asking whether they
     meant the thing they just did. */
  it('does not put the issue dialog in the way', async () => {
    await renderPage();
    await closeAndCharge('מזומן');

    expect(screen.queryByText(/אינו ניתן למחיקה/)).toBeNull();
  });

  it('says the payment landed and what document came of it', async () => {
    const store = await renderPage();
    await closeAndCharge('מזומן');

    expect(toasts(store)).toContain('ticket.paymentTaken');
    expect(toasts(store)).toContain('invoiceIssue.issued');
  });
});

/* An open charge is not a payment. The customer owes money, and the document
   that says so is a חשבונית מס — which is a decision about a debt, made from
   the button, not a record of money that arrived. */
describe('closing with an open balance', () => {
  it('issues nothing', async () => {
    await renderPage();
    await closeAndCharge('חיוב פתוח');

    expect(issueInvoice).not.toHaveBeenCalled();
  });
});

/* Both of these happen after the money is already recorded. Neither may read as
   a failed payment, and neither may be silent — an uninvoiced payment nobody was
   told about is worse than either message. */
describe('when no document can be issued', () => {
  it('says so plainly when the garage has no invoicing connected', async () => {
    invoicingActive.mockResolvedValue(false);
    const store = await renderPage();
    await closeAndCharge('מזומן');

    expect(issueInvoice).not.toHaveBeenCalled();
    expect(toasts(store)).toContain('ticket.paymentTaken');
    expect(toasts(store)).toContain('ticket.paidNoInvoicing');
  });

  it('keeps the payment message when the provider refuses', async () => {
    issueInvoice.mockRejectedValue(new Error('iCount rejected the document'));
    const store = await renderPage();
    await closeAndCharge('מזומן');

    // The payment stands on its own; the error is about the document only.
    expect(toasts(store)).toContain('ticket.paymentTaken');
    expect(toasts(store).length).toBeGreaterThan(1);
  });
});
