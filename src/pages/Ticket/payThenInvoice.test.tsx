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
 * What is pinned here is the join between the two: that closing a ticket issues
 * the document the drawer named, and that the payment decides only WHICH one —
 * a מס-קבלה for money that arrived, a חשבונית מס for money that has not. The
 * cases where nothing can be issued matter most: the close is already recorded
 * by then, so neither a missing provider nor a refusing one may be allowed to
 * look like the close itself failed.
 */

import type { Invoice, Ticket } from '@garage/shared';
import { configureStore } from '@reduxjs/toolkit';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { Provider } from 'react-redux';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const issueInvoice = vi.fn();
const invoicingActive = vi.fn();
const listInvoices = vi.fn();
const collectInvoice = vi.fn();

vi.mock('@garage/shared', async (importActual) => {
  const actual = await importActual<typeof import('@garage/shared')>();
  return {
    ...actual,
    garageName: () => 'מוסך הבדיקה',
    listTicketPhotos: vi.fn(async () => []),
    subscribeToTicketPhotos: vi.fn(() => () => {}),
    listWorkDefs: vi.fn(async () => []),
    listItems: vi.fn(async () => []),
    listInvoices: (...a: unknown[]) => listInvoices(...a),
    subscribeToInvoices: vi.fn(() => () => {}),
    listCustomers: vi.fn(async () => []),
    updateCustomer: vi.fn(async () => {}),
    subscribeToTable: vi.fn(() => () => {}),
    isGarageAdmin: () => true,
    issueInvoice: (...a: unknown[]) => issueInvoice(...a),
    collectInvoice: (...a: unknown[]) => collectInvoice(...a),
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

const invoice = (over: Partial<Invoice> = {}): Invoice =>
  ({
    id: 'inv1', ticketKey: 'GAR-7', docType: 'invoice_receipt', status: 'issued',
    docnum: '20451', allocationNumber: null, pdfUrl: null, provider: 'icount',
    issuedAt: '2026-08-01T00:00:00Z', customerName: 'דנה כהן', lines: [],
    subtotal: 1000, vatRate: 0.18, vat: 180, total: 1180,
    ...over,
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

/* The same drawer, opened on a bill instead of a job. Only the last button
   differs — it offers to issue the receipt rather than to close the ticket. */
const collectThroughDrawer = async (method: string) => {
  await act(async () => { screen.getByText('גבה תשלום').click(); });

  const drawer = () => {
    const asides = document.querySelectorAll('aside');
    return within(asides[asides.length - 1] as HTMLElement);
  };

  await act(async () => { drawer().getByText(method).click(); });
  await act(async () => { drawer().getByText('המשך').click(); });
  await act(async () => { drawer().getByText('המשך').click(); });
  await act(async () => { drawer().getByText(/^הפק קבלה/).click(); });
  await act(async () => { await vi.advanceTimersByTimeAsync(900); });
  await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
  await act(async () => { await Promise.resolve(); });
};

const toasts = (store: ReturnType<typeof configureStore>) =>
  (store.getState() as { toast: { items: Array<{ key: string }> } }).toast.items.map((x) => x.key);

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  issueInvoice.mockReset().mockResolvedValue(invoice());
  invoicingActive.mockReset().mockResolvedValue(true);
  listInvoices.mockReset().mockResolvedValue([]);
  collectInvoice.mockReset().mockResolvedValue({ receipt: invoice({ docType: 'receipt' }), owed: 0 });
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

/* An open charge is not a payment — but it is still billed, and the drawer says
   so three times over: on the collect step, in the summary, and on the success
   screen, all of them reading "יופק חשבונית מס (חיוב פתוח)".

   This used to assert that nothing was issued, which is what the code did and
   the opposite of what those three screens promised. The debt side had the same
   backlog the paid side had — jobs closed against a customer's account with no
   invoice behind them, and output VAT owed on none of them. So what is pinned
   now is that the payment decides WHICH document, never whether there is one. */
describe('closing with an open balance', () => {
  it('issues a tax invoice, not an invoice-receipt', async () => {
    await renderPage();
    await closeAndCharge('חיוב פתוח');

    expect(issueInvoice).toHaveBeenCalledTimes(1);
    expect(issueInvoice).toHaveBeenCalledWith('GAR-7', 'tax_invoice');
  });

  it('reports the close and the document it produced', async () => {
    const store = await renderPage();
    await closeAndCharge('חיוב פתוח');

    expect(toasts(store)).toContain('ticket.closedWithBalance');
    expect(toasts(store)).toContain('invoiceIssue.issued');
  });

  /* The no-provider message is its own: the paid one opens "התשלום נקלט", and on
     an open charge no payment was taken to report. */
  it('says so in its own words when the garage has no invoicing connected', async () => {
    invoicingActive.mockResolvedValue(false);
    const store = await renderPage();
    await closeAndCharge('חיוב פתוח');

    expect(issueInvoice).not.toHaveBeenCalled();
    expect(toasts(store)).toContain('ticket.closedNoInvoicing');
    expect(toasts(store)).not.toContain('ticket.paidNoInvoicing');
  });
});

/* Once the bill exists, the primary button stops meaning "close" and starts
   meaning "collect".

   It reads "גבה תשלום" as soon as the work is done, and it used to open the
   close drawer regardless: pick a method, pay, and the ticket went to שולם. But
   the drawer ends in issueNow(), and the Edge Function refuses to bill a ticket
   twice — so it handed back the invoice already issued, announced it as though
   it were new, and produced no קבלה. The ticket said paid, the provider still
   showed the bill outstanding, and nothing on screen said so. */
describe('a ticket that already carries an open tax invoice', () => {
  const openBill = () => invoice({ id: 'inv1', docType: 'tax_invoice', total: 1180 });

  it('collects on it instead of opening the close drawer', async () => {
    listInvoices.mockResolvedValue([openBill()]);
    await renderPage();

    await act(async () => { screen.getByText('גבה תשלום').click(); });

    /* The collect dialog, not step 1 of the drawer. "חיוב פתוח" is the drawer's
       own method — the page carries no other copy of it. */
    expect(screen.queryByText('רישום תשלום')).not.toBeNull();
    expect(screen.queryByText('חיוב פתוח')).toBeNull();
  });

  it('never asks the provider to bill the ticket a second time', async () => {
    listInvoices.mockResolvedValue([openBill()]);
    await renderPage();

    await act(async () => { screen.getByText('גבה תשלום').click(); });

    expect(issueInvoice).not.toHaveBeenCalled();
  });

  /* The open charge is the one card the collect drawer does not carry: the bill
     exists, so "pay later" is the state the ticket is already in. */
  it('offers no open-charge card', async () => {
    listInvoices.mockResolvedValue([openBill()]);
    await renderPage();

    await act(async () => { screen.getByText('גבה תשלום').click(); });

    expect(screen.queryByText('מזומן')).not.toBeNull();
    expect(screen.queryByText('תשלום בהמשך - יתרה פתוחה')).toBeNull();
  });

  it('collects the outstanding amount through the drawer', async () => {
    listInvoices.mockResolvedValue([openBill()]);
    await renderPage();
    await collectThroughDrawer('מזומן');

    expect(collectInvoice).toHaveBeenCalledTimes(1);
    const [invoiceId, amount, method] = collectInvoice.mock.calls[0];
    expect(invoiceId).toBe('inv1');
    expect(amount).toBe(1180);
    expect(method).toBe('cash');
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
