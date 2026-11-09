import {
  addressLabel, collectInvoice, createCustomer, creditInvoice, creditableRemainder, customerHoldingIdNumber, idNumberConflict, invoicingActive, mainPayMethod, paymentsTotal, isBill, isGarageAdmin, isUsablePhone, issueInvoice, listCustomers, listInvoices, listTicketPhotos, money, normalizeIdNumber, owedRemainder, phoneDigits, subscribeToInvoices, subscribeToTable, subscribeToTicketPhotos, updateCustomer, type BillDocType, type Customer, type Invoice, type PaymentPart, type PhoneConflict, type Ticket, type TicketPhoto, type TicketWork,
} from '@garage/shared';
import {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useCloseTicket, useCollectPayment, type CloseResult } from '../../features/ticket/CloseTicketModal';
import { storedAmount, ticketTotals } from '../../features/ticket/ticketTotals';
import { payMethodLabel } from '../../lib/payMethodLabel';
import {
  showError, showErrorKey, showInfo, showSuccess, useAppDispatch, useBusyRun, useConfirm,
  useModalResult, usePrompt,
} from '../../store';


export interface UseTicketPageOptions {
  ticket: Ticket;
  /** Writes the ticket and resolves once it is stored; rejects when it is not.
   *  See useTickets.saveTicket. */
  saveTicket: (next: Ticket) => Promise<void>;
  onBack: () => void;
  /** Cancels the ticket on the server; throws when it refuses. See useTickets. */
  onCancelTicket: (key: string, reason: string) => Promise<void>;
  /** Reports unsaved edits up to the shell, which asks before any exit — the
   *  sidebar, Back, signing out — discards them. See app/useLeaveGuard. */
  onDirtyChange?: (dirty: boolean) => void;
}

/** Of the receipts on a ticket, the live one — else the most recent. A ticket
 *  can hold several over its life: issue, cancel, re-issue. */
/* The ticket's bill, whichever of the two it was issued as. A ticket has one:
   the Edge Function refuses to bill a ticket that already carries either. */
const currentInvoice = (all: readonly Invoice[], ticketKey: string) => {
  const bills = all.filter((i) => i.ticketKey === ticketKey && isBill(i));
  return bills.find((i) => i.status === 'issued') ?? bills[0] ?? null;
};

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const round2 = (n: number) => Math.round(n * 100) / 100;

/** One round of the drawer, as a payment among the visit's others. */
const partOf = (r: CloseResult): PaymentPart => ({
  method: r.method!,
  amount: r.amount,
  ...(r.reference ? { reference: r.reference } : {}),
});

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

     - cancelling the ticket, which asks its own questions and is not an edit;
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
export function useTicketPage({ ticket, saveTicket, onBack, onCancelTicket, onDirtyChange }: UseTicketPageOptions) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const run = useBusyRun();
  const confirm = useConfirm();
  const prompt = usePrompt();
  const openModal = useModalResult<boolean>();
  const openCloseDrawer = useCloseTicket();
  const openCollectDrawer = useCollectPayment();

  const [photos, setPhotos] = useState<TicketPhoto[]>([]);
  /* Every document this ticket has produced, not just the live receipt: a
     credit note is a document of its own, and "how much of this invoice is
     still creditable" is the invoice minus the notes already written against
     it. Holding only the receipt made that unanswerable. */
  const [ticketDocs, setTicketDocs] = useState<Invoice[]>([]);
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
    void load();
    const off = subscribeToTicketPhotos(() => void load());
    return () => { alive = false; off(); };
  }, [ticket.k]);

  useEffect(() => {
    let alive = true;
    const load = () =>
      listInvoices()
        .then((all) => { if (alive) setTicketDocs(all.filter((i) => i.ticketKey === ticket.k)); })
        .catch(() => {});   // an absent invoice panel beats a broken page
    void load();
    const off = subscribeToInvoices(() => void load());
    return () => { alive = false; off(); };
  }, [ticket.k]);

  /** The receipt the panel is about. Derived rather than stored, so a credit
   *  note landing over realtime updates the figures beside it too. */
  const invoice = useMemo(() => currentInvoice(ticketDocs, ticket.k), [ticketDocs, ticket.k]);

  /** What is left to hand back on it: nothing once it is fully credited, which
   *  is also when the button stops being offered. */
  const creditable = useMemo(
    () => (invoice ? creditableRemainder(invoice, ticketDocs) : 0),
    [invoice, ticketDocs],
  );

  /** What the customer still owes on it — zero unless this is a live חשבונית מס
   *  with money outstanding, which is the only case that can be collected. */
  const owed = useMemo(
    () => (invoice ? owedRemainder(invoice, ticketDocs) : 0),
    [invoice, ticketDocs],
  );

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
      /* Moved to another customer: what was typed into the ת״ז box was about
         the one it is leaving, and the details now are the new one's own. */
      const moved = (next.customerId ?? null) !== (ticket.customerId ?? null);

      /* The same two the intake form insists on: the name says who, the phone
         is how they are found on the next visit. */
      if (next.customer !== ticket.customer && !next.customer.trim()) {
        dispatch(showErrorKey('ticket.customerNameRequired'));
        return false;
      }
      if (next.phone !== ticket.phone && !isUsablePhone(next.phone ?? '')) {
        dispatch(showErrorKey('ticket.customerPhoneInvalid'));
        return false;
      }

      setBusy(true);
      try {
        /* A correction of this customer's details is a correction of the
           customer, not of this visit only — the next ticket should open with
           it. Written first, so a refusal leaves the ticket as it was. Other
           tickets keep the details they were opened with. */
        if (!moved && customer) {
          const fix: Partial<Omit<Customer, 'id'>> = {};
          if (next.customer.trim() !== ticket.customer.trim()) fix.name = next.customer.trim();
          if ((next.phone ?? '') !== (ticket.phone ?? '')) fix.phone = next.phone?.trim() || null;
          if ((next.email ?? '') !== (ticket.email ?? '')) fix.email = next.email?.trim() || null;
          /* The ticket holds one address line, the record a street and a city.
             The line as typed goes to the street, and the city is cleared so
             the next intake does not print it twice. */
          if ((next.address ?? '') !== (ticket.address ?? '')) {
            fix.address = next.address?.trim() || null;
            fix.city = null;
          }
          if (Object.keys(fix).length) {
            await updateCustomer(customer.id, fix);
            await loadCustomers();
          }
        }
        if (idDirty && !moved) {
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
        /* Awaited. It used to hand the row to setTickets, which paints and
           writes in the background, and report "saved" at once — so close-and-
           charge went on to issue a tax document from whatever the database
           held at that moment, and a write that failed was never this code's
           business. A failure now lands in the catch below with the draft
           intact, so the edits are still on screen to save again. */
        if (!same(next, ticket)) {
          await saveTicket(next);
          setDraft(next);
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
    [customer, dispatch, draft, idConflict, idDirty, idNumber, loadCustomers, saveTicket, ticket],
  );

  /** Move the ticket to another customer — an existing one, or one created here
   *  from a name and a phone. A save of its own, like close-and-charge: other
   *  pending edits go with it. The car follows in the database
   *  (tickets_customer_moves_vehicle). */
  const switchCustomer = useCallback(
    async (to: Customer | { name: string; phone: string }) => {
      const ok = await confirm({
        bodyKey: 'ticket.confirmSwitchCustomer',
        values: { from: ticket.customer, to: to.name.trim() },
      });
      if (!ok) return false;
      let target: Customer;
      if ('id' in to) {
        target = to;
      } else {
        try {
          target = await createCustomer({
            name: to.name.trim(), phone: to.phone.trim(),
            email: null, address: null, city: null, kind: 'private', id_number: null,
          });
        } catch (e) {
          dispatch(showError(e));
          return false;
        }
        await loadCustomers();
      }
      // The new record's ת״ז, so the box does not read as an edit of it.
      setIdNumber(normalizeIdNumber(target.id_number));
      return save({
        customerId: target.id,
        customer: target.name,
        phone: target.phone ?? '',
        email: target.email ?? '',
        address: addressLabel({ address: target.address ?? '', city: target.city ?? '' }),
      });
    },
    [confirm, dispatch, loadCustomers, save, ticket.customer],
  );

  /** Back to where it was on the server. The one way out of an edit that is not
   *  typing the old value back in. */
  const discard = useCallback(() => {
    setDraft(ticket);
    setIdNumber(storedId);
  }, [storedId, ticket]);

  /* The act itself, with no dialog in front of it and no check that the ticket
     is saved. Both callers below supply what they need: the button asks first
     and refuses to invoice unsaved works; the close-and-charge drawer has just
     saved the ticket itself and has already told the customer's money apart from
     the question of whether to bill it. */
  const issueNow = useCallback(async (docType: BillDocType, payments?: PaymentPart[]) => {
    /* Both ways of issuing come through here, so the overlay is claimed here
       too rather than at each caller. The wait is a provider round-trip over a
       network — the longest thing this page does, and the one a disabled button
       says nothing about. */
    const inv = await run('busy.issuingInvoice', () => (payments
      ? issueInvoice(ticket.k, docType, payments)
      : issueInvoice(ticket.k, docType)));
    setTicketDocs((prev) => [inv, ...prev.filter((i) => i.id !== inv.id)]);
    dispatch(showSuccess('invoiceIssue.issued', {
      docType: inv.docType, docnum: inv.docnum, total: money(inv.total),
    }));
    return inv;
  }, [dispatch, run, ticket.k]);

  /** Issuing by hand is guarded by its own dialog, not by the generic confirm:
   *  the copy names the amount and says the document cannot be deleted. */
  const issue = useCallback(async (docType: BillDocType = 'invoice_receipt') => {
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
      docType,
    });
    if (!ok) return;

    setBusy(true);
    try {
      await issueNow(docType);
    } catch (e) {
      dispatch(showError(e));
    } finally {
      setBusy(false);
    }
  }, [dirty, dispatch, issueNow, openModal, ticket.customer, totals.total]);

  /* One visit's payments, gathered before anything is issued.

     A customer paying in parts is usually still at the counter — some cash,
     the rest on a card — so after every part the drawer opens again on what is
     left. Nothing is issued between rounds: the visit gets ONE document naming
     every method, rather than a receipt per part. The rounds end when nothing
     is owed or the drawer is closed, and closing is how the rest is left for
     another day.

     Appends to `parts` and returns it. `due` is what is owed before them. */
  const gather = useCallback(async (parts: PaymentPart[], due: number, docnum: string) => {
    let left = round2(due - paymentsTotal(parts));
    while (left > 0) {
      const answer = await openCollectDrawer(draft, left, docnum, paymentsTotal(parts));
      /* Collecting offers no open-charge card, so a finished drawer always names
         a method — but the type allows null, and defaulting beats asserting. */
      if (!answer || !answer.method) break;
      parts.push(partOf(answer));
      left = round2(left - answer.amount);
    }
    return parts;
  }, [draft, openCollectDrawer]);

  /* Money arriving against a חשבונית מס, as one קבלה for the visit.

     The ticket follows the money: collecting the last of what is owed is the
     moment the job is actually paid for, so the ticket goes to שולם — the same
     transition the close-and-charge drawer makes, reached from the other end.
     A part payment moves nothing: the customer still owes the rest.

     Takes the bill and its balance as arguments rather than reading them from
     state, because closing with a part payment calls it on a bill issued a
     moment ago — before the page's own `invoice` and `owed` have caught up. */
  const collectOn = useCallback(async (invoice: Invoice, owed: number, parts: PaymentPart[] = []) => {
    /* The same drawer the counter uses, opened on what is still owed. Taking
       money is one act with one screen, whether the customer is standing there
       at the end of the job or settling a bill from last month. */
    await gather(parts, owed, invoice.docnum);
    if (parts.length === 0) return;

    setBusy(true);
    try {
      const { receipt, owed: left } = await run('busy.collecting', () => collectInvoice(invoice.id, parts));
      setTicketDocs((await listInvoices()).filter((i) => i.ticketKey === ticket.k));

      if (left <= 0) {
        /* Through save(), so it reaches the database and the board the way any
           other status change does. */
        await save({ st: 'paid', paid: true, payMethod: mainPayMethod(parts) ?? undefined });
      }
      dispatch(showSuccess(left <= 0 ? 'collect.doneFull' : 'collect.donePartial', {
        docnum: receipt.docnum,
        amount: money(receipt.total),
        left: money(left),
      }));
    } catch (e) {
      /* Never reported as taken: a receipt nobody issued is not a payment the
         books know about. The bill still shows all of it owed, and the button
         offers to collect it again. */
      dispatch(showError(e));
    } finally {
      setBusy(false);
    }
  }, [dispatch, gather, run, save, ticket.k]);

  const collect = useCallback(async () => {
    if (invoice) await collectOn(invoice, owed);
  }, [collectOn, invoice, owed]);

  /* Give the customer money back — all of what is left on the invoice, or part
     of it. The dialog opens on the whole remaining amount, because that is the
     common case and typing a total by hand is how a digit goes missing.

     A full credit voids the invoice AND takes the ticket back out of שולם: the
     money was returned, so a card still reading "paid" is a lie the garage will
     read as takings. The status goes back to מוכן, which also lifts the ticket
     out of the archive — a credited job is one somebody still has to deal with.
     A partial credit changes no status: the ticket was paid, and most of it
     still is.

     Admin only. The Edge Function refuses a member with a 403 of its own; this
     just means a mechanic is not shown a button that will fail. */
  const credit = useCallback(async () => {
    if (!invoice || creditable <= 0) return;

    const answer = await openModal('creditNote', {
      remaining: creditable,
      invoiceTotal: invoice.total,
      docnum: invoice.docnum,
      customer: ticket.customer,
      /* The rate this document was issued at, not today's — a credit is priced
         by the invoice it corrects. */
      vatRate: invoice.vatRate,
    }) as { amount: number; reason: string } | null;
    if (!answer) return;

    setBusy(true);
    try {
      const { cancelled, note } = await run('busy.crediting',
        () => creditInvoice(invoice.id, answer.amount, answer.reason));
      setTicketDocs((await listInvoices()).filter((i) => i.ticketKey === ticket.k));

      if (cancelled) {
        /* Through save(), not setDraft: this has to reach the database and the
           board, and it is the same write any other status change makes. */
        await save({ st: 'done', paid: false });
      }
      dispatch(showSuccess(cancelled ? 'credit.doneFull' : 'credit.donePartial', {
        docnum: note.docnum,
        amount: money(note.total),
      }));
    } catch (e) {
      dispatch(showError(e));
    } finally {
      setBusy(false);
    }
  }, [creditable, dispatch, invoice, openModal, run, save, ticket.customer, ticket.k]);

  /* Off the board or back onto it, from inside the ticket. Applied at once
     rather than held in the draft: it is a view choice, not an edit to the
     ticket, and "save" is not where anybody would look for it to take effect.
     The draft gets the same value, so a save of other pending edits carries it
     rather than putting back the old one. */
  const setBoardHidden = useCallback(
    (boardHidden: boolean) => {
      setDraft((d) => ({ ...d, boardHidden }));
      saveTicket({ ...ticket, boardHidden })
        .then(() => dispatch(showInfo(boardHidden ? 'board.hiddenToast' : 'board.shownToast')))
        .catch((e) => {
          setDraft((d) => ({ ...d, boardHidden: !boardHidden }));
          dispatch(showError(e));
        });
    },
    [dispatch, saveTicket, ticket],
  );

  /** Cancel, never delete: a numbered work order stays on file under its
   *  customer. Asks for the reason (the database requires one), refuses up
   *  front while there is an issued bill — the server refuses too, this just
   *  says why before the round trip — and then confirms. */
  const cancel = useCallback(async () => {
    if (invoice?.status === 'issued') {
      dispatch(showErrorKey('ticket.cancelHasInvoice', { key: ticket.k }));
      return;
    }
    const reason = await prompt({ titleKey: 'ticket.cancelTitle', labelKey: 'ticket.cancelReason' });
    if (reason === null) return;
    if (!reason.trim()) {
      dispatch(showErrorKey('ticket.cancelReasonRequired'));
      return;
    }
    const ok = await confirm({
      bodyKey: 'ticket.confirmCancel',
      values: { key: ticket.k },
      danger: true,
    });
    if (!ok) return;
    try {
      await run('busy.cancellingTicket', () => onCancelTicket(ticket.k, reason));
    } catch (e) {
      dispatch(showError(e));
      return;
    }
    dispatch(showSuccess('ticket.cancelled', { key: ticket.k }));
    /* Unsaved edits cannot land on a frozen ticket. Cleared before navigating,
       or the shell would ask about discarding them. */
    onDirtyChange?.(false);
    onBack();
  }, [confirm, dispatch, invoice, onBack, onCancelTicket, onDirtyChange, prompt, run, ticket.k]);

  /** Opens the close-and-charge drawer and applies whatever it comes back with.
   *  A dismissed drawer resolves null and changes nothing.
   *
   *  This is the one edit that does not wait for the save button, because it is
   *  itself a save: it takes money. Whatever else is pending goes with it. */
  const close = useCallback(
    async () => {
      /* A ticket that already carries an open חשבונית מס is not closed again —
         it is collected on. The primary button says "גבה תשלום" once the work is
         done, and it meant the drawer: pick a method, pay, and the ticket went to
         שולם. But the drawer ends in issueNow(), and the Edge Function refuses to
         bill a ticket twice — so it returned the invoice already issued, reported
         it as though it had just been issued, and produced no קבלה at all. The
         ticket read שולם, the provider still showed the bill outstanding, and the
         two only disagreed more the longer nobody looked.

         The button now does what its label says. Collecting is a different act
         from closing — it settles a debt rather than ending a job — and the
         ticket reaches שולם through collect() when the last of it comes in. */
      if (invoice && owed > 0) {
        await collect();
        return;
      }

      /* Asked before the drawer opens rather than after, because it decides
         what the drawer may offer: a part payment leaves a balance, and the
         balance is read off the tax invoice and its receipts. With no provider
         there are none, and the rest would be owed with nothing remembering it. */
      const invoicing = await invoicingActive();

      const total = round2(totals.total);
      const first: CloseResult | null = await openCloseDrawer(draft, total, invoicing);
      if (!first) return;

      /* The first round is the close drawer itself; a part payment there opens
         the collect drawer on the rest, round after round, before anything is
         saved or issued. See gather(). */
      const parts: PaymentPart[] = first.method ? [partOf(first)] : [];
      if (first.method && !first.paid) await gather(parts, total, '');

      const taken = paymentsTotal(parts);
      const paid = parts.length > 0 && taken >= total;
      /** Money taken, but not all of it. */
      const partPaid = parts.length > 0 && !paid;
      const left = Math.max(0, round2(total - taken));
      const methods = [...new Set(parts.map((p) => payMethodLabel(t, p.method) ?? '-'))].join(' + ');

      const saved = await save({
        // paid → "שולם"; closed with an open balance stays "מוכן לאיסוף"
        st: paid ? 'paid' : 'done',
        done: draft.subtasks.length,
        paid,
        /* A code, or nothing at all — an open charge is not a way of paying,
           so the column that says how the money arrived stays empty. Several
           methods are named by the one that brought in the most; the document
           itself lists them all. */
        payMethod: mainPayMethod(parts) ?? undefined,
        doc: paid ? t('close.docReceipt') : partPaid ? t('close.docInvoiceAndReceipt') : first.doc,
        reference: parts.length === 1 ? parts[0].reference : undefined,
      });
      if (!saved) return;

      dispatch(
        partPaid
          ? showSuccess('ticket.partPaymentTaken', { method: methods, amount: money(taken), left: money(left) })
          : paid
          /* No longer names the document it is about to issue. It used to, and
             the claim was made before anything had been issued — now the
             issuing itself reports, with the number the provider actually gave
             back. Two messages, and the second one is true. */
          ? showSuccess('ticket.paymentTaken', { method: methods, total: money(total) })
          : showErrorKey('ticket.closedWithBalance', { total: money(total) }),
      );

      /* The document follows the money, without a second trip into the ticket.
         The drawer has said "יופק חשבונית מס-קבלה" and "המסמך יישלח ללקוח בסיום
         התהליך" since it was written; until now nothing issued it, so the
         promise was kept by hand or not at all — and a garage that collected on
         Friday and remembered on Monday had a week of takings with no documents
         behind them.

         The open charge follows the debt the same way, and for the same reason.
         Pick חיוב פתוח and the drawer names the document three times: "יופק
         חשבונית מס (חיוב פתוח)". Jobs closed against a customer's account with
         no invoice behind them would owe output VAT on none of them.

         So the only thing the payment decides is WHICH document:
         - all of it paid → one מס-קבלה, naming every method used;
         - part of it → a חשבונית מס for the job, and one קבלה for what arrived
           today, naming every method — the rest is then an open bill like any
           other, collected later by "גבה תשלום";
         - none of it → the חשבונית מס alone.

         Deliberately without the confirmation dialog the button puts up: the
         person has just worked through a drawer that names the document twice
         and ends on "גבה ₪X". Asking again would be asking whether they meant
         the thing they just did. */

      /* A garage that has not connected its provider takes money and writes its
         documents elsewhere. That is a normal way to run, not a failure to
         report on top of a payment that succeeded — so it is asked first rather
         than discovered from an error. (It is never offered a part payment, so
         it has at most one.) */
      if (!invoicing) {
        dispatch(showInfo(paid ? 'ticket.paidNoInvoicing' : 'ticket.closedNoInvoicing'));
        return;
      }

      setBusy(true);
      try {
        if (paid) {
          /* One method is the ordinary document, read off the saved ticket as
             it always was; several are sent, and the server checks they add up
             to the bill. */
          await issueNow('invoice_receipt', parts.length > 1 ? parts : undefined);
        } else {
          const bill = await issueNow('tax_invoice');
          if (partPaid) {
            /* If this fails the bill stands with all of it owed, which is what
               the screen will then say — the button offers to collect it again.
               Never reported as taken: a receipt nobody issued is not a payment
               the books know about. */
            const { receipt, owed: stillOwed } = await run('busy.collecting', () => collectInvoice(bill.id, parts));
            setTicketDocs((await listInvoices()).filter((i) => i.ticketKey === ticket.k));
            dispatch(showSuccess('collect.donePartial', {
              docnum: receipt.docnum,
              amount: money(receipt.total),
              left: money(stillOwed),
            }));
          }
        }
      } catch (e) {
        /* The close is recorded and the document is not. Both facts are already
           on screen — the drawer's own message stands, and this says what is
           missing and implies the button that fixes it. Never swallowed: a
           closed ticket whose document nobody was told about is the one outcome
           worse than either message, and it reads the same whether the money
           arrived or was left on the customer's account. */
        dispatch(showError(e));
      } finally {
        setBusy(false);
      }
    },
    [collect, dispatch, draft, gather, invoice, issueNow, openCloseDrawer, owed, run, save, t, ticket.k, totals.total],
  );

  /* Leaving with something unsaved asks first — but not here. The close button
     is one exit of several, and the question is asked once, by the shell, for
     all of them (app/useLeaveGuard). Asking here as well would ask twice. */
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  const leave = useCallback(async () => { onBack(); }, [onBack]);

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
    customer, customers, idNumber, setIdNumber, idConflict, switchCustomer,
    /* What is still creditable, and whether this user may. Both are needed to
       decide the button: a fully credited invoice offers nothing to anybody,
       and a member may not credit at all. */
    creditable, canCredit: isGarageAdmin(),
    /** What is still owed on an open חשבונית מס. Zero for every other document,
     *  which is what decides whether a payment can be recorded at all. */
    owed,
    patch, setWorks, assign, save, discard, issue, collect, credit, cancel, close, leave,
    setBoardHidden,
  };
}
