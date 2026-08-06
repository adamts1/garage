import { phoneDigits, ticketCustomerKey, VAT, type Status, type Ticket } from '@garage/shared';
import { useMemo, useState } from 'react';

export type DocFilter = 'all' | 'paid' | 'open' | 'none';

export interface ReportRow {
  name: string;
  /** The number the row is identified by — blank for the phoneless tickets that
   *  predate the phone being required, which still group by name. */
  phone: string;
  /** The identity the row rolled up under (`phone:…` or `name:…`), not a
   *  display number. It was a sequential 1001+i that meant nothing and changed
   *  as soon as a filter did. */
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
    // By name or by number, since the number is what identifies the customer —
    // and it is what the advisor has in front of them when someone calls.
    if (q) {
      const qDigits = phoneDigits(q);
      const byName = t.customer.toLowerCase().includes(q);
      const byPhone = qDigits.length >= 3 && phoneDigits(t.phone).includes(qDigits);
      if (!byName && !byPhone) return false;
    }
    return true;
  });

  /* Grouped by the customer's own row id — the internal one, which is the only
     thing that means one customer.

     It grouped by name first, and disagreed with the database in both
     directions: one person whose name was typed two ways became two rows and
     looked like two customers, while two people sharing a name became one row
     whose total belonged to nobody. Then by phone, which was the identity at
     the time — and stopped being one, because a household, a company and a
     parent paying for a student's car all answer a single line. Billing a
     couple's two cars to one row is the same error as the name, with better
     manners. Tickets predating a resolved customer still fall back to the
     phone; see ticketCustomerKey in @garage/shared. */
  const byCustomer = new Map<string, Ticket[]>();
  kept.forEach((t) => {
    const key = ticketCustomerKey(t);
    const list = byCustomer.get(key) ?? [];
    list.push(t);
    byCustomer.set(key, list);
  });

  return [...byCustomer.entries()].map(([key, list]) => {
    const gross = list.reduce((s, t) => s + t.amount, 0);
    // Ticket amounts are VAT-inclusive, so net is backed out rather than added.
    const net = gross / (1 + VAT);
    const balance = list
      .filter((t) => t.st === 'done' && !t.paid)
      .reduce((s, t) => s + t.amount, 0);
    /* The newest ticket's name, because that is the one most recently confirmed
       at the counter — an older ticket may carry a typo the customer has since
       corrected. Tickets arrive newest-first from listTickets. */
    return {
      name: list[0].customer,
      phone: list[0].phone ?? '',
      id: key,
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
