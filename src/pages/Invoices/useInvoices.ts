import { listInvoices, subscribeToInvoices, type Invoice } from '@garage/shared';
import { useEffect, useMemo, useState } from 'react';
import { showError, useAppDispatch } from '../../store';
import { headline, netTotal } from './invoiceTotals';

export type StatusFilter = 'all' | Invoice['status'];
export type DocTypeFilter = 'all' | Invoice['docType'];

export function useInvoices() {
  const dispatch = useAppDispatch();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
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
    totals: useMemo(() => headline(invoices), [invoices]),
    shownNet: useMemo(() => netTotal(shown), [shown]),
    /* Resolved from the list rather than held as its own object, so a realtime
       update to the open invoice is reflected instead of pinned. */
    selected: invoices.find((i) => i.id === selectedId) ?? null,
    selectedId,
    setSelectedId,
    query, setQuery,
    status, setStatus,
    docType, setDocType,
  };
}
