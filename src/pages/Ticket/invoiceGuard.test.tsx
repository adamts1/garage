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
const cancelInvoice = vi.fn();
const listInvoices = vi.fn();

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
    cancelInvoice: (...a: unknown[]) => cancelInvoice(...a),
    subscribeToInvoices: vi.fn(() => () => {}),
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
  cancelInvoice.mockReset().mockResolvedValue(undefined);
  listInvoices.mockReset().mockResolvedValue([]);
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

describe('cancelling an invoice', () => {
  beforeEach(() => { listInvoices.mockResolvedValue([invoice()]); });

  const openCancel = async () => {
    await renderPage();
    await act(async () => { screen.getByText(/בטל חשבונית/).click(); });
    await act(async () => { await Promise.resolve(); });
  };

  /* fireEvent, not a raw assignment: React installs its own value setter on the
     input prototype, so setting .value directly leaves its state untouched. */
  const typeReason = (reason: string) =>
    fireEvent.change(screen.getByLabelText(/סיבת הביטול/), { target: { value: reason } });

  it('asks for a reason and does nothing if the dialog is dismissed', async () => {
    await openCancel();
    await act(async () => { screen.getByText('ביטול').click(); });

    // Dismissing must not issue a credit note.
    expect(cancelInvoice).not.toHaveBeenCalled();
  });

  it('cancels with the reason given', async () => {
    await openCancel();
    await act(async () => { typeReason('טעות בסכום'); });
    await act(async () => { screen.getByText('אישור').click(); });

    expect(cancelInvoice).toHaveBeenCalledWith('inv1', 'טעות בסכום');
  });

  it('falls back to a default reason when the box is left empty', async () => {
    await openCancel();
    await act(async () => { screen.getByText('אישור').click(); });

    expect(cancelInvoice).toHaveBeenCalledWith('inv1', 'ביטול חשבונית');
  });

  it('offers no cancel for an already-cancelled invoice', async () => {
    listInvoices.mockResolvedValue([invoice({ status: 'cancelled' })]);
    await renderPage();

    expect(screen.queryByText(/בטל חשבונית/)).toBeNull();
  });
});
