// @vitest-environment jsdom
import type { Invoice, Ticket } from '@garage/shared';
import { configureStore } from '@reduxjs/toolkit';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { Provider } from 'react-redux';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/* Issuing an invoice-receipt creates a REAL tax document at iCount, against a
   real garage's credentials, for a real customer. There is no sandbox in the
   provider adapter — whichever database the app points at is where the document
   is issued. The only undo is a credit note, which is itself a real document.

   So the one behaviour worth pinning before this page is restructured is the
   guard: a click on "issue" must never issue. It must open a dialog, and only
   the dialog's own button may call through.

   Written before the refactor, deliberately. */

const issueInvoice = vi.fn();
const creditInvoice = vi.fn();
const listInvoices = vi.fn();
/* Crediting is an admin's call, and the page hides the button from anybody
   else. Admin by default here; the last case below turns it off. */
const isGarageAdmin = vi.fn(() => true);

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
    issueInvoice: (...a: unknown[]) => issueInvoice(...a),
    creditInvoice: (...a: unknown[]) => creditInvoice(...a),
    isGarageAdmin: () => isGarageAdmin(),
    subscribeToInvoices: vi.fn(() => () => {}),
    // The page reads the garage's customers to show (and warn about) the ת״ז.
    listCustomers: vi.fn(async () => []),
    updateCustomer: vi.fn(async () => {}),
    subscribeToTable: vi.fn(() => () => {}),
  };
});

await import('../../i18n');
const { default: TicketPage } = await import('./TicketPage');
const { CatalogProvider } = await import('../../features/catalog');
const { ModalHost } = await import('../../components/Modal');
const { default: modal } = await import('../../store/modalSlice');
const { default: toast } = await import('../../store/toastSlice');

const ticket = (over: Partial<Ticket> = {}): Ticket =>
  ({
    k: 'GAR-7', st: 'paid', paid: true, type: 'job', epic: 'service', prio: 'med', pts: 3,
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
  }) as Invoice;

const renderPage = async (t: Ticket = ticket()) => {
  const store = configureStore({ reducer: { toast, modal } });
  render(
    <StrictMode>
      <Provider store={store}>
        <CatalogProvider>
          <TicketPage
            ticket={t}
            setTickets={() => {}}
            workers={[]}
            workerChips={{} as never}
            onBack={() => {}}
          />
          {/* The issue dialog and the cancel prompt now come from the registry,
              so the host has to be mounted for either to appear at all. */}
          <ModalHost />
        </CatalogProvider>
      </Provider>
    </StrictMode>,
  );
  // let the photo + invoice effects settle
  await act(async () => { await Promise.resolve(); });
};

beforeEach(() => {
  issueInvoice.mockReset().mockResolvedValue(invoice());
  creditInvoice.mockReset().mockResolvedValue({
    note: invoice({ id: 'note1', docType: 'credit_note', docnum: '3001', total: 1180 }),
    cancelled: true,
    remaining: 0,
  });
  listInvoices.mockReset().mockResolvedValue([]);
  isGarageAdmin.mockReturnValue(true);
});

afterEach(cleanup);

describe('issuing an invoice', () => {
  it('does not issue when the issue button is pressed', async () => {
    await renderPage();
    await act(async () => { screen.getByText(/הפק חשבונית מס-קבלה/).click(); });

    // The click opens a dialog. Nothing has been sent to the provider.
    expect(issueInvoice).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('warns that the document cannot be deleted', async () => {
    await renderPage();
    await act(async () => { screen.getByText(/הפק חשבונית מס-קבלה/).click(); });

    expect(screen.getByText(/אינו ניתן למחיקה/)).toBeTruthy();
  });

  it('issues once, and only from the dialog', async () => {
    await renderPage();
    await act(async () => { screen.getByText(/הפק חשבונית מס-קבלה/).click(); });
    await act(async () => { screen.getByText('הפק חשבונית').click(); });

    expect(issueInvoice).toHaveBeenCalledTimes(1);
    expect(issueInvoice).toHaveBeenCalledWith('GAR-7');
  });

  it('issues nothing when the dialog is cancelled', async () => {
    await renderPage();
    await act(async () => { screen.getByText(/הפק חשבונית מס-קבלה/).click(); });
    await act(async () => { screen.getByText('ביטול').click(); });

    expect(issueInvoice).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('offers nothing to issue while the ticket is unpaid', async () => {
    await renderPage(ticket({ st: 'done', paid: false }));

    // Finished is not settled: an unpaid ticket has no invoice button at all.
    expect(screen.queryByText(/הפק חשבונית מס-קבלה/)).toBeNull();
  });
});

/* Handing money back is the same class of act as issuing: a real document at
   the provider, against a real customer, with no undo. So the same guard
   applies — a click on the button must open a dialog and nothing else — plus
   two rules that are specific to giving money back: never more than is left on
   the invoice, and only an admin at all. */
describe('crediting a customer', () => {
  beforeEach(() => { listInvoices.mockResolvedValue([invoice()]); });

  const openCredit = async () => {
    await renderPage();
    await act(async () => { screen.getByText(/זכה לקוח/).click(); });
    await act(async () => { await Promise.resolve(); });
  };

  /* fireEvent, not a raw assignment: React installs its own value setter on the
     input prototype, so setting .value directly leaves its state untouched. */
  const type = (label: RegExp, value: string) =>
    fireEvent.change(screen.getByLabelText(label), { target: { value } });

  it('opens a dialog rather than crediting on the click', async () => {
    await openCredit();
    expect(creditInvoice).not.toHaveBeenCalled();
  });

  it('does nothing when the dialog is dismissed', async () => {
    await openCredit();
    await act(async () => { screen.getByText('ביטול').click(); });

    expect(creditInvoice).not.toHaveBeenCalled();
  });

  /* The common case, and why the box opens filled in: crediting the whole of
     what is left is one confirmation, not a total typed by hand. */
  it('offers the full remaining amount, and credits it as it stands', async () => {
    await openCredit();
    await act(async () => { type(/סכום לזיכוי/, '1180'); });
    await act(async () => { screen.getByText(/הפק חשבונית זיכוי/).click(); });

    expect(creditInvoice).toHaveBeenCalledWith('inv1', 1180, '');
  });

  it('credits part of the bill, with the reason typed on it', async () => {
    await openCredit();
    await act(async () => {
      type(/סכום לזיכוי/, '300');
      type(/סיבת הזיכוי/, 'החלק הוחזר');
    });
    await act(async () => { screen.getByText(/הפק חשבונית זיכוי/).click(); });

    expect(creditInvoice).toHaveBeenCalledWith('inv1', 300, 'החלק הוחזר');
  });

  /* The server refuses this too — it is the only place the answer is
     authoritative — but a request that cannot succeed should not be sent. */
  it('refuses an amount larger than what is left on the invoice', async () => {
    await openCredit();
    await act(async () => { type(/סכום לזיכוי/, '5000'); });
    await act(async () => { screen.getByText(/הפק חשבונית זיכוי/).click(); });

    expect(creditInvoice).not.toHaveBeenCalled();
  });

  it('refuses a zero or negative amount', async () => {
    await openCredit();
    for (const amount of ['0', '-50']) {
      await act(async () => { type(/סכום לזיכוי/, amount); });
      await act(async () => { screen.getByText(/הפק חשבונית זיכוי/).click(); });
    }
    expect(creditInvoice).not.toHaveBeenCalled();
  });

  it('offers nothing on an invoice that was already cancelled', async () => {
    listInvoices.mockResolvedValue([invoice({ status: 'cancelled' })]);
    await renderPage();

    expect(screen.queryByText(/זכה לקוח/)).toBeNull();
  });

  /* Fully credited across two notes: the invoice is still 'issued' in this
     fixture, and there is nothing left to give back. */
  it('offers nothing once the whole invoice has been credited', async () => {
    listInvoices.mockResolvedValue([
      invoice(),
      invoice({ id: 'n1', docType: 'credit_note', total: 900, creditsInvoiceId: 'inv1' }),
      invoice({ id: 'n2', docType: 'credit_note', total: 280, creditsInvoiceId: 'inv1' }),
    ]);
    await renderPage();

    expect(screen.queryByText(/זכה לקוח/)).toBeNull();
  });

  it('shows a member nothing to click — money back is an admin decision', async () => {
    isGarageAdmin.mockReturnValue(false);
    await renderPage();

    expect(screen.queryByText(/זכה לקוח/)).toBeNull();
  });
});
