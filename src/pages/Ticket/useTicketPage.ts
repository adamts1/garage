import {
  cancelInvoice, customerHoldingIdNumber, idNumberConflict, issueInvoice, listCustomers, listInvoices, listTicketPhotos, money, normalizeIdNumber, phoneDigits, subscribeToInvoices, subscribeToTable, subscribeToTicketPhotos, updateCustomer, type Customer, type Invoice, type PhoneConflict, type Ticket, type TicketPhoto, type TicketWork,
} from '@garage/shared';
import {
  useCallback, useEffect, useMemo, useRef, useState,
  type Dispatch, type SetStateAction,
} from 'react';
import { useCloseTicket, type CloseResult } from '../../features/ticket/CloseTicketModal';
import { storedAmount, ticketTotals } from '../../features/ticket/ticketTotals';
import {
  showError, showErrorKey, showSuccess, useAppDispatch, useConfirm, useModalResult, usePrompt,
} from '../../store';


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

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/* The ticket page edits a DRAFT, and the draft reaches the database only when
   somebody saves it.

   It used to write on every keystroke's blur and on every change to a work: the
   notes box, the assignee, the price of a line — each one its own round trip,
   each one final. That made "I was looking at what this would cost" and "this
   is what we are charging" the same act, and left no way to change your mind
   except to type the old value back. The phone app has always worked the other
   way (mobile/components/TicketEditor.tsx keeps a draft and a dirty flag); this
   brings the board into line with it.

   Three things do NOT wait for the save button, and each for a reason:

     - deleting the ticket, which asks its own question and is not an edit;
     - closing and charging, which IS a save — it opens a drawer, takes money
       and writes a payment, so it commits whatever else is pending with it
       rather than leaving a paid ticket beside unsaved works;
     - the invoice, which is issued by the server from the stored row. That one
       is refused while there are unsaved changes, because a document built from
       a row that does not match the screen is not something you can take back.

   The ת״ז rides along in the same save but lands somewhere else: it is a column
   on `customers`, not on `tickets`, so it is held beside the draft rather than
   inside it — otherwise every ticket read back from the server would look
   edited the moment the customer had a number. */
export function useTicketPage({ ticket, setTickets, onBack }: UseTicketPageOptions) {
  const dispatch = useAppDispatch();
  const confirm = useConfirm();
  const prompt = usePrompt();
  const openModal = useModalResult<boolean>();
  const openCloseDrawer = useCloseTicket();

  const [photos, setPhotos] = useState<TicketPhoto[]>([]);
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [busy, setBusy] = useState(false);

  const [draft, setDraft] = useState<Ticket>(ticket);
  /* What the server last said, so a change arriving from somebody else can be
     told apart from one made here. Compared against, never rendered. */
  const serverRow = useRef<Ticket>(ticket);

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [idNumber, setIdNumber] = useState('');

  const works = draft.works ?? [];
  const totals = ticketTotals(works);

  /* Switching which ticket the page shows drops the draft outright: a half-typed
     note must not follow the reader to the next car. */
  useEffect(() => {
    setDraft(ticket);
    serverRow.current = ticket;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticket.k]);

  /* Somebody else edited this ticket. Their version is adopted only if nothing
     is pending here — a live board must show a status drag from the next room,
     but not at the cost of the sentence being typed into the notes box. */
  useEffect(() => {
    setDraft((d) => (same(d, serverRow.current) ? ticket : d));
    serverRow.current = ticket;
  }, [ticket]);

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

  /* The garage's customers: needed to read this ticket's ת״ז, and to say who
     already holds one that is typed in. */
  const loadCustomers = useCallback(
    () => listCustomers().then(setCustomers).catch(() => {}),
    [],
  );

  useEffect(() => {
    void loadCustomers();
    return subscribeToTable('customers', () => void loadCustomers());
  }, [loadCustomers]);

  /* Which record this ticket belongs to. By the id create_ticket resolved, and
     failing that by the phone — the ticket's `customer` is a denormalised name,
     and two people share one often enough that matching on it would put a ת״ז
     on a stranger.

     The phone fallback is for tickets written before the RPC resolved a
     customer at all, and it now insists on being unambiguous: a number may
     belong to several customers, and this screen's whole purpose for the record
     is writing a ת״ז onto it. Picking the first of two people who answer one
     line and stamping a national ID on them is the exact mistake the name match
     was rejected for. No single holder, no record — the ticket still reads and
     saves, only the ת״ז field has nothing to attach to. */
  const customer = useMemo(() => {
    if (ticket.customerId) return customers.find((c) => c.id === ticket.customerId) ?? null;
    const digits = phoneDigits(ticket.phone);
    if (digits.length < 9) return null;
    const holders = customers.filter((c) => phoneDigits(c.phone) === digits);
    return holders.length === 1 ? holders[0] : null;
  }, [customers, ticket.customerId, ticket.phone]);

  /* The stored ת״ז becomes the field's starting value — and re-becomes it
     whenever the record itself changes, unless it is being edited right now. */
  const storedId = normalizeIdNumber(customer?.id_number);
  const storedIdRef = useRef(storedId);
  useEffect(() => {
    /* `previous` is read here and not inside the updater: an updater runs at
       render time, by which point the ref has already moved on and every field
       would look edited. */
    const previous = storedIdRef.current;
    storedIdRef.current = storedId;
    setIdNumber((current) => (current === previous ? storedId : current));
  }, [storedId]);

  const idDirty = normalizeIdNumber(idNumber) !== storedId;
  const ticketDirty = !same(draft, ticket);
  const dirty = ticketDirty || idDirty;

  /** Somebody else in this garage already holds the number being typed. Reported,
   *  not decided — same as the intake form's phone warning. */
  const idConflict: PhoneConflict<Customer> | null = useMemo(
    () =>
      idNumberConflict(customers, {
        idNumber,
        name: draft.customer,
        ownerId: customer?.id ?? null,
      }),
    [customers, draft.customer, idNumber, customer?.id],
  );

  /** Local edits. Nothing here reaches the database until `save`. */
  const patch = useCallback(
    (p: Partial<Ticket>) => setDraft((d) => ({ ...d, ...p })),
    [],
  );

  const setWorks = useCallback(
    (next: TicketWork[]) =>
      patch({ works: next, amount: storedAmount(next), subtasks: next.map((w) => w.name) }),
    [patch],
  );

  /** Hand the ticket to somebody, or take it off everybody. A worker code, or
   *  null — never '', which the foreign key would reject as a code and which
   *  would be a second way of saying "nobody". */
  const assign = useCallback((who: string | null) => patch({ who: who || null }), [patch]);

  /* Save.
     `over` is for close-and-charge, which decides a status and a payment in a
     drawer and then commits everything at once. */
  const save = useCallback(
    async (over?: Partial<Ticket>) => {
      /* The database would refuse this anyway — the ת״ז is unique per garage —
         and it would refuse it by naming a constraint. Say whose it is instead,
         and save nothing rather than half of it. */
      if (idConflict) {
        dispatch(showErrorKey('ticket.idTakenBlocked', { name: idConflict.customer.name }));
        return false;
      }

      const next: Ticket = { ...draft, ...over };
      setBusy(true);
      try {
        if (idDirty) {
          if (!customer) {
            dispatch(showErrorKey('ticket.noCustomerRecord'));
            return false;
          }
          const wanted = normalizeIdNumber(idNumber);

          /* Ask the database, not the list on this screen. The customers here
             were loaded when the page opened; somebody entered at another
             counter since is not among them, and the unique index would then
             refuse the write by naming a constraint rather than a person. */
          const holder = wanted ? await customerHoldingIdNumber(wanted, customer.id) : null;
          if (holder) {
            dispatch(showErrorKey('ticket.idTakenBlocked', { name: holder.name }));
            await loadCustomers();   // so the warning appears in the card too
            return false;
          }

          await updateCustomer(customer.id, { id_number: wanted || null });
          await loadCustomers();
        }
        if (!same(next, ticket)) {
          setDraft(next);
          setTickets((prev) => prev.map((t) => (t.k === ticket.k ? next : t)));
        }
        dispatch(showSuccess('ticket.saved'));
        return true;
      } catch (e) {
        dispatch(showError(e));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [customer, dispatch, draft, idConflict, idDirty, idNumber, loadCustomers, setTickets, ticket],
  );

  /** Back to where it was on the server. The one way out of an edit that is not
   *  typing the old value back in. */
  const discard = useCallback(() => {
    setDraft(ticket);
    setIdNumber(storedId);
  }, [storedId, ticket]);

  /** Issuing is guarded by its own dialog, not by the generic confirm: the copy
   *  names the amount and says the document cannot be deleted. */
  const issue = useCallback(async () => {
    /* The server builds the document from the stored row, so unsaved works
       would be missing from a real tax document. Refuse rather than silently
       invoice a version of the ticket nobody is looking at. */
    if (dirty) {
      dispatch(showErrorKey('ticket.saveBeforeInvoice'));
      return;
    }

    const ok = await openModal('issueInvoice', {
      amount: money(totals.total),
      customer: ticket.customer,
    });
    if (!ok) return;

    setBusy(true);
    try {
      const inv = await issueInvoice(ticket.k);
      setInvoice(inv);
      dispatch(showSuccess('invoiceIssue.issued', { docnum: inv.docnum, total: money(inv.total) }));
    } catch (e) {
      dispatch(showError(e));
    } finally {
      setBusy(false);
    }
  }, [dirty, dispatch, openModal, ticket.customer, ticket.k, totals.total]);

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
   *  A dismissed drawer resolves null and changes nothing.
   *
   *  This is the one edit that does not wait for the save button, because it is
   *  itself a save: it takes money. Whatever else is pending goes with it. */
  const close = useCallback(
    async () => {
      const result: CloseResult | null = await openCloseDrawer(draft, totals.total);
      if (!result) return;

      const saved = await save({
        // paid → "שולם"; closed with an open balance stays "מוכן לאיסוף"
        st: result.paid ? 'paid' : 'done',
        done: draft.subtasks.length,
        paid: result.paid,
        payMethod: result.method,
        doc: result.doc,
        reference: result.reference,
      });
      if (!saved) return;

      dispatch(
        result.paid
          ? showSuccess('ticket.paymentTaken', {
              method: result.method, total: money(totals.total), doc: result.doc,
            })
          : showErrorKey('ticket.closedWithBalance', { total: money(totals.total) }),
      );
    },
    [dispatch, draft, openCloseDrawer, save, totals.total],
  );

  /** Leaving with something unsaved asks first. */
  const leave = useCallback(async () => {
    if (dirty && !(await confirm({ bodyKey: 'ticket.confirmLeave', danger: true }))) return;
    onBack();
  }, [confirm, dirty, onBack]);

  /* Closing the tab is the one exit this page cannot put a dialog in front of,
     so it uses the browser's own. Registered only while there is something to
     lose — an always-on handler asks about a page nobody edited. */
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  return {
    draft, photos, invoice, busy, totals, works, dirty,
    customer, idNumber, setIdNumber, idConflict,
    patch, setWorks, assign, save, discard, issue, cancel, remove, close, leave,
  };
}
