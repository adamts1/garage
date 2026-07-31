import { VAT, type Status, type Ticket } from '@garage/shared';
import { useMemo, useState } from 'react';

export type DocFilter = 'all' | 'paid' | 'open' | 'none';

export interface ReportRow {
  name: string;
  id: string;
  tickets: number;
  /** Before VAT. */
  net: number;
  vat: number;
  /** Including VAT. */
  gross: number;
  /** Closed but unpaid. */
  balance: number;
  avg: number;
}

export interface ReportTotals {
  gross: number;
  net: number;
  vat: number;
  count: number;
  customers: number;
  avg: number;
}

/** The filtering and the roll-up, with no rendering in sight — which is what
 *  makes the arithmetic here testable on its own. */
export function rollUp(
  tickets: readonly Ticket[],
  { status, docFilter, query }: { status: Status | 'all'; docFilter: DocFilter; query: string },
): ReportRow[] {
  const q = query.trim().toLowerCase();

  const kept = tickets.filter((t) => {
    if (status !== 'all' && t.st !== status) return false;
    if (docFilter === 'paid' && !t.paid) return false;
    if (docFilter === 'open' && !(t.doc && !t.paid)) return false;
    if (docFilter === 'none' && t.doc) return false;
    if (q && !t.customer.toLowerCase().includes(q)) return false;
    return true;
  });

  const byCustomer = new Map<string, Ticket[]>();
  kept.forEach((t) => {
    const list = byCustomer.get(t.customer) ?? [];
    list.push(t);
    byCustomer.set(t.customer, list);
  });

  return [...byCustomer.entries()].map(([name, list], i) => {
    const gross = list.reduce((s, t) => s + t.amount, 0);
    // Ticket amounts are VAT-inclusive, so net is backed out rather than added.
    const net = gross / (1 + VAT);
    const balance = list
      .filter((t) => t.st === 'done' && !t.paid)
      .reduce((s, t) => s + t.amount, 0);
    return {
      name,
      id: String(1001 + i),
      tickets: list.length,
      net,
      vat: gross - net,
      gross,
      balance,
      avg: list.length ? gross / list.length : 0,
    };
  });
}

export function totalsOf(rows: readonly ReportRow[]): ReportTotals {
  const gross = rows.reduce((s, r) => s + r.gross, 0);
  const net = rows.reduce((s, r) => s + r.net, 0);
  const count = rows.reduce((s, r) => s + r.tickets, 0);
  return {
    gross,
    net,
    vat: gross - net,
    count,
    customers: rows.length,
    avg: count ? gross / count : 0,
  };
}

export function useCustomerReport(tickets: readonly Ticket[]) {
  const [status, setStatus] = useState<Status | 'all'>('all');
  const [docFilter, setDocFilter] = useState<DocFilter>('all');
  const [query, setQuery] = useState('');

  const rows = useMemo(
    () => rollUp(tickets, { status, docFilter, query }),
    [tickets, status, docFilter, query],
  );

  const totals = useMemo(() => totalsOf(rows), [rows]);

  const filtered = status !== 'all' || docFilter !== 'all' || query.trim() !== '';

  const clear = () => {
    setStatus('all');
    setDocFilter('all');
    setQuery('');
  };

  return {
    rows, totals, filtered, clear,
    status, setStatus,
    docFilter, setDocFilter,
    query, setQuery,
  };
}
