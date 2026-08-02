import {
  cancelInvoice, issueInvoice, listInvoices, listTicketPhotos,
  subscribeToInvoices, subscribeToTicketPhotos,
  type Invoice, type Ticket, type TicketPhoto, type TicketWork,
} from '@garage/shared';
import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { useCloseTicket, type CloseResult } from '../../features/ticket/CloseTicketModal';
import { storedAmount, ticketTotals } from '../../features/ticket/ticketTotals';
import {
  showError, showErrorKey, showSuccess, useAppDispatch, useConfirm, useModalResult, usePrompt,
} from '../../store';

const shekel = (n: number) =>
  '₪' + n.toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export interface UseTicketPageOptions {
  ticket: Ticket;
  setTickets: Dispatch<SetStateAction<Ticket[]>>;
  onBack: () => void;
}

/** Of the receipts on a ticket, the live one — else the most recent. A ticket
 *  can hold several over its life: issue, cancel, re-issue. */
const currentInvoice = (all: readonly Invoice[], ticketKey: string) => {
  const receipts = all.filter((i) => i.ticketKey === ticketKey && i.docType === 'invoice_receipt');
  return receipts.find((i) => i.status === 'issued') ?? receipts[0] ?? null;
};

export function useTicketPage({ ticket, setTickets, onBack }: UseTicketPageOptions) {
  const dispatch = useAppDispatch();
  const confirm = useConfirm();
  const prompt = usePrompt();
  const openModal = useModalResult<boolean>();
  const openCloseDrawer = useCloseTicket();

  const [photos, setPhotos] = useState<TicketPhoto[]>([]);
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [busy, setBusy] = useState(false);

  const works = ticket.works ?? [];
  const totals = ticketTotals(works);

  /* Photos are taken on the phone; this screen is read-only for them. The
     subscription is what makes one appear seconds after the mechanic shoots it. */
  useEffect(() => {
    let alive = true;
    const load = () =>
      listTicketPhotos(ticket.k)
        .then((p) => { if (alive) setPhotos(p); })
        .catch(() => { if (alive) setPhotos([]); });   // an empty gallery beats a broken page
    load();
    const off = subscribeToTicketPhotos(load);
    return () => { alive = false; off(); };
  }, [ticket.k]);

  useEffect(() => {
    let alive = true;
    const load = () =>
      listInvoices()
        .then((all) => { if (alive) setInvoice(currentInvoice(all, ticket.k)); })
        .catch(() => {});   // an absent invoice panel beats a broken page
    load();
    const off = subscribeToInvoices(load);
    return () => { alive = false; off(); };
  }, [ticket.k]);

  const patch = useCallback(
    (p: Partial<Ticket>) =>
      setTickets((prev) => prev.map((t) => (t.k === ticket.k ? { ...t, ...p } : t))),
    [setTickets, ticket.k],
  );

  const setWorks = useCallback(
    (next: TicketWork[]) =>
      patch({ works: next, amount: storedAmount(next), subtasks: next.map((w) => w.name) }),
    [patch],
  );

  /** Issuing is guarded by its own dialog, not by the generic confirm: the copy
   *  names the amount and says the document cannot be deleted. */
  const issue = useCallback(async () => {
    const ok = await openModal('issueInvoice', {
      amount: shekel(totals.total),
      customer: ticket.customer,
    });
    if (!ok) return;

    setBusy(true);
    try {
      const inv = await issueInvoice(ticket.k);
      setInvoice(inv);
      dispatch(showSuccess('invoiceIssue.issued', { docnum: inv.docnum, total: shekel(inv.total) }));
    } catch (e) {
      dispatch(showError(e));
    } finally {
      setBusy(false);
    }
  }, [dispatch, openModal, ticket.customer, ticket.k, totals.total]);

  const cancel = useCallback(async () => {
    if (!invoice) return;

    const reason = await prompt({
      titleKey: 'invoiceCancel.title',
      labelKey: 'invoiceCancel.reason',
      defaultValue: '',
    });
    /* null is "dismissed" and must not issue a credit note. '' is "left blank
       on purpose" and falls back to a default — a different answer. */
    if (reason === null) return;

    setBusy(true);
    try {
      await cancelInvoice(invoice.id, reason || 'ביטול חשבונית');
      setInvoice(currentInvoice(await listInvoices(), ticket.k));
      dispatch(showSuccess('invoiceCancel.done'));
    } catch (e) {
      dispatch(showError(e));
    } finally {
      setBusy(false);
    }
  }, [dispatch, invoice, prompt, ticket.k]);

  /** Deleting a ticket had no confirmation at all — less protection than
   *  deleting a supplier, for something that takes the invoices and photos
   *  with it. */
  const remove = useCallback(async () => {
    const ok = await confirm({
      bodyKey: invoice ? 'ticket.confirmDeleteInvoiced' : 'ticket.confirmDelete',
      values: { key: ticket.k },
      danger: true,
    });
    if (!ok) return;
    setTickets((prev) => prev.filter((t) => t.k !== ticket.k));
    dispatch(showSuccess('ticket.deleted'));
    onBack();
  }, [confirm, dispatch, invoice, onBack, setTickets, ticket.k]);

  /** Opens the close-and-charge drawer and applies whatever it comes back with.
   *  A dismissed drawer resolves null and changes nothing. */
  const close = useCallback(
    async () => {
      const result: CloseResult | null = await openCloseDrawer(ticket, totals.total);
      if (!result) return;

      patch({
        // paid → "שולם"; closed with an open balance stays "מוכן לאיסוף"
        st: result.paid ? 'paid' : 'done',
        done: ticket.subtasks.length,
        paid: result.paid,
        payMethod: result.method,
        doc: result.doc,
        reference: result.reference,
      });
      dispatch(
        result.paid
          ? showSuccess('ticket.paymentTaken', {
              method: result.method, total: shekel(totals.total), doc: result.doc,
            })
          : showErrorKey('ticket.closedWithBalance', { total: shekel(totals.total) }),
      );
    },
    [dispatch, openCloseDrawer, patch, ticket, totals.total],
  );

  return { photos, invoice, busy, totals, works, patch, setWorks, issue, cancel, remove, close };
}
