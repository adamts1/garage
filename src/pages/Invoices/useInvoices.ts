import {
  creditInvoice, creditableRemainder, isGarageAdmin, listInvoices, money, subscribeToInvoices,
  type Invoice,
} from '@garage/shared';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { showError, showSuccess, useAppDispatch, useModalResult } from '../../store';
import { headline, netTotal } from './invoiceTotals';

export type StatusFilter = 'all' | Invoice['status'];
export type DocTypeFilter = 'all' | Invoice['docType'];

export function useInvoices() {
  const dispatch = useAppDispatch();
  const openModal = useModalResult<{ amount: number; reason: string } | null>();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [crediting, setCrediting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [docType, setDocType] = useState<DocTypeFilter>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      listInvoices()
        .then((rows) => { if (alive) setInvoices(rows); })
        .catch((e) => {
          /* The old page swallowed this and showed an empty ledger, which is
             indistinguishable from a garage that has issued nothing. */
          if (alive) dispatch(showError(e));
        })
        .finally(() => { if (alive) setLoading(false); });

    load();
    const off = subscribeToInvoices(load);
    return () => { alive = false; off(); };
  }, [dispatch]);

  /* Crediting from the ledger, not only from the ticket. This is the screen a
     bookkeeper works in — they arrive at a document number, not at a car — and
     until now the only way to give money back was to find the ticket behind it,
     which for a ticket that was since deleted was no way at all.

     The same call as the ticket page's, so the two cannot drift; the Edge
     Function is where the rules live (admin only, never more than is left). */
  const credit = useCallback(
    async (invoice: Invoice) => {
      const remaining = creditableRemainder(invoice, invoices);
      if (remaining <= 0) return;

      const answer = await openModal('creditNote', {
        remaining,
        invoiceTotal: invoice.total,
        docnum: invoice.docnum,
        customer: invoice.customerName ?? '',
      });
      if (!answer) return;

      setCrediting(true);
      try {
        const { cancelled, note } = await creditInvoice(invoice.id, answer.amount, answer.reason);
        setInvoices(await listInvoices());
        dispatch(showSuccess(cancelled ? 'credit.doneFull' : 'credit.donePartial', {
          docnum: note.docnum,
          amount: money(note.total),
        }));
      } catch (e) {
        dispatch(showError(e));
      } finally {
        setCrediting(false);
      }
    },
    [dispatch, invoices, openModal],
  );

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return invoices.filter((i) => {
      if (status !== 'all' && i.status !== status) return false;
      if (docType !== 'all' && i.docType !== docType) return false;
      if (!q) return true;
      return (
        i.docnum.toLowerCase().includes(q) ||
        (i.customerName ?? '').toLowerCase().includes(q) ||
        (i.ticketKey ?? '').toLowerCase().includes(q)
      );
    });
  }, [invoices, query, status, docType]);

  const filtered = status !== 'all' || docType !== 'all' || query.trim() !== '';

  const clear = () => {
    setQuery('');
    setStatus('all');
    setDocType('all');
  };

  return {
    invoices,
    shown,
    loading,
    filtered,
    clear,
    credit,
    crediting,
    /* What is left on the open document, and whether this user may hand it
       back. A member sees the ledger and not the button — the function refuses
       them anyway, and a button that always fails is worse than none. */
    canCredit: isGarageAdmin(),
    totals: useMemo(() => headline(invoices), [invoices]),
    shownNet: useMemo(() => netTotal(shown), [shown]),
    /* Resolved from the list rather than held as its own object, so a realtime
       update to the open invoice is reflected instead of pinned. */
    selected: invoices.find((i) => i.id === selectedId) ?? null,
    selectedCreditable: useMemo(() => {
      const open = invoices.find((i) => i.id === selectedId);
      return open ? creditableRemainder(open, invoices) : 0;
    }, [invoices, selectedId]),
    selectedId,
    setSelectedId,
    query, setQuery,
    status, setStatus,
    docType, setDocType,
  };
}
