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
  /** Awaited, unlike setTickets — see useTickets.saveTicket. */
  saveTicket: (next: Ticket, worksChanged: boolean) => Promise<void>;
  onBack: () => void;
}

/** Of the receipts on a ticket, the live one — else the most recent. A ticket
 *  can hold several over its life: issue, cancel, re-issue. */
const currentInvoice = (all: readonly Invoice[], ticketKey: string) => {
  const receipts = all.filter((i) => i.ticketKey === ticketKey && i.docType === 'invoice_receipt');
  return receipts.find((i) => i.status === 'issued') ?? receipts[0] ?? null;
};

export function useTicketPage({ ticket, setTickets, saveTicket, onBack }: UseTicketPageOptions) {
  const dispatch = useAppDispatch();
  const confirm = useConfirm();
  const prompt = usePrompt();
  const openModal = useModalResult<boolean>();
  const openCloseDrawer = useCloseTicket();

  const [photos, setPhotos] = useState<TicketPhoto[]>([]);
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [busy, setBusy] = useState(false);

  /* The edits in hand, not yet written.
   *
   * Everything on this screen used to go straight through setTickets, which
   * persists on the spot — so a keystroke in a work's name became a
   * save_ticket_works call that deleted and re-inserted the ticket's entire
   * works tree, and broadcast it to every other screen. Thirty characters of
   * note, thirty transactions. It also meant the "שמור" button had nothing to
   * do, and indeed it did nothing: it scrolled.
   *
   * null means "no local edits" — the screen then shows the stored ticket, and
   * realtime updates flow through as before. Same model the phone editor has
   * always used (mobile/components/TicketEditor.tsx). */
  const [draft, setDraft] = useState<Ticket | null>(null);

  /* A different ticket is a different draft. Keyed on the ticket's own key
     rather than on the object, which realtime replaces on every refetch. */
  useEffect(() => { setDraft(null); }, [ticket.k]);

  /** What the screen renders: the edits if there are any, else what is stored. */
  const view = draft ?? ticket;

  const works = view.works ?? [];
  const totals = ticketTotals(works);

  /* Same comparison the phone uses. Cheap enough at one ticket, and it means a
     change and a change back correctly reads as no change at all. */
  const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(ticket);
  const worksChanged =
    draft !== null && JSON.stringify(draft.works ?? []) !== JSON.stringify(ticket.works ?? []);

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

  /** Edits the draft. Nothing reaches the database until save(). */
  const patch = useCallback(
    (p: Partial<Ticket>) => setDraft((d) => ({ ...(d ?? ticket), ...p })),
    [ticket],
  );

  const setWorks = useCallback(
    (next: TicketWork[]) =>
      patch({ works: next, amount: storedAmount(next), subtasks: next.map((w) => w.name) }),
    [patch],
  );

  /* Write the draft, then drop it so the screen goes back to reading the stored
     ticket — which is also how a concurrent edit becomes visible again.
     Resolves either way: a caller that wanted to save-then-act needs to know
     whether it may act. */
  const save = useCallback(async (): Promise<boolean> => {
    if (!draft || !dirty) return true;
    setBusy(true);
    try {
      await saveTicket(draft, worksChanged);
      setDraft(null);
      return true;
    } catch (e) {
      dispatch(showError(e));
      return false;
    } finally {
      setBusy(false);
    }
  }, [dirty, dispatch, draft, saveTicket, worksChanged]);

  /* Anything that writes to the server, or mints a document from what is on
     screen, has to be looking at the same numbers the database is. An invoice
     is the sharp case: its lines are frozen at issue and it cannot be deleted,
     only credited. So the pending edits go first, and the action is abandoned
     if they could not be written. */
  const saveFirst = useCallback(async (): Promise<boolean> => {
    if (!dirty) return true;
    return save();
  }, [dirty, save]);

  /** Issuing is guarded by its own dialog, not by the generic confirm: the copy
   *  names the amount and says the document cannot be deleted. */
  const issue = useCallback(async () => {
    const ok = await openModal('issueInvoice', {
      amount: shekel(totals.total),
      customer: view.customer,
    });
    if (!ok) return;

    /* After the dialog, not before: the amount it quoted is the draft's, and
       the document must be built from the same rows. issue-invoice reads the
       ticket from the database, so an unsaved work would be quoted here and
       missing from the invoice — permanently, since it cannot be deleted. */
    if (!(await saveFirst())) return;

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
  }, [dispatch, openModal, saveFirst, ticket.k, totals.total, view.customer]);

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
      // The drawer quotes the total, so it has to be shown the draft's works.
      const result: CloseResult | null = await openCloseDrawer(view, totals.total);
      if (!result) return;

      /* Written as ONE save, not as a patch that waits for the button: closing
         is an explicit act with a receipt behind it, and it carries whatever
         was pending with it. Two writes would leave a window where the ticket
         is paid but priced from before the edit. */
      const closed: Ticket = {
        ...view,
        // paid → "שולם"; closed with an open balance stays "מוכן"
        st: result.paid ? 'paid' : 'done',
        done: view.subtasks.length,
        paid: result.paid,
        payMethod: result.method,
        doc: result.doc,
        reference: result.reference,
      };

      setBusy(true);
      try {
        await saveTicket(closed, worksChanged);
        setDraft(null);
        dispatch(
          result.paid
            ? showSuccess('ticket.paymentTaken', {
                method: result.method, total: shekel(totals.total), doc: result.doc,
              })
            : showErrorKey('ticket.closedWithBalance', { total: shekel(totals.total) }),
        );
      } catch (e) {
        dispatch(showError(e));
      } finally {
        setBusy(false);
      }
    },
    [dispatch, openCloseDrawer, saveTicket, totals.total, view, worksChanged],
  );

  /** Leaving with edits in hand. Asked here rather than in the component so the
   *  page and any future caller cannot disagree about what counts as unsaved. */
  const confirmLeave = useCallback(async (): Promise<boolean> => {
    if (!dirty) return true;
    return confirm({ bodyKey: 'ticket.confirmLeaveUnsaved', danger: true });
  }, [confirm, dirty]);

  /* The tab closing is the one exit the app cannot intercept with a dialog of
     its own, so it gets the browser's. Only while there is something to lose —
     an unconditional handler nags on every close. */
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  return {
    photos, invoice, busy, totals, works, ticket: view,
    dirty, patch, setWorks, save, confirmLeave,
    issue, cancel, remove, close,
  };
}
