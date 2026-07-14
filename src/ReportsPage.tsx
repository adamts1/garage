import { useMemo, useState } from 'react';
import { VAT } from './catalog';
import { COLUMNS, type Status, type Ticket } from './board-data';
import { IconCustomers, IconDoc, IconPrint, IconReports, IconTickets } from './icons';

const money = (n: number) =>
  '₪' + n.toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type DocFilter = 'all' | 'paid' | 'open' | 'none';
type SortKey = 'name' | 'tickets' | 'net' | 'vat' | 'gross' | 'balance' | 'avg';

interface Row {
  name: string;
  id: string;
  tickets: number;
  net: number;      // before VAT
  vat: number;
  gross: number;    // incl. VAT
  balance: number;  // closed but unpaid
  avg: number;
}

export default function ReportsPage({ tickets }: { tickets: Ticket[] }) {
  const [status, setStatus] = useState<Status | 'all'>('all');
  const [docFilter, setDocFilter] = useState<DocFilter>('all');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<{ by: SortKey; dir: 1 | -1 }>({ by: 'gross', dir: -1 });
  const [perPage, setPerPage] = useState(10);
  const [page, setPage] = useState(1);

  /* ---- filter the tickets, then roll them up per customer ---- */
  const rows = useMemo<Row[]>(() => {
    const kept = tickets.filter((t) => {
      if (status !== 'all' && t.st !== status) return false;
      if (docFilter === 'paid' && !t.paid) return false;
      if (docFilter === 'open' && !(t.doc && !t.paid)) return false;
      if (docFilter === 'none' && t.doc) return false;
      if (query && !t.customer.toLowerCase().includes(query.toLowerCase())) return false;
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
      const net = gross / (1 + VAT);            // ticket amounts are VAT-inclusive
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
  }, [tickets, status, docFilter, query]);

  const sorted = useMemo(() => [...rows].sort((a, b) => {
    const x = a[sort.by];
    const y = b[sort.by];
    if (x === y) return 0;
    return (x > y ? 1 : -1) * sort.dir;
  }), [rows, sort]);

  const pages = Math.max(1, Math.ceil(sorted.length / perPage));
  const current = Math.min(page, pages);
  const slice = sorted.slice((current - 1) * perPage, current * perPage);

  /* ---- headline numbers ---- */
  const totals = useMemo(() => {
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
  }, [rows]);

  const toggleSort = (by: SortKey) =>
    setSort((p) => (p.by === by ? { by, dir: p.dir === 1 ? -1 : 1 } : { by, dir: -1 }));

  const exportCsv = () => {
    const head = ['לקוח', 'מזהה', 'כרטיסי עבודה', 'לפני מע״מ', 'מע״מ', 'סה״כ', 'יתרה פתוחה', 'ממוצע'];
    const body = sorted.map((r) =>
      [r.name, r.id, r.tickets, r.net.toFixed(2), r.vat.toFixed(2), r.gross.toFixed(2), r.balance.toFixed(2), r.avg.toFixed(2)]);
    const csv = [head, ...body].map((line) => line.join(',')).join('\n');
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'customer-report.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const clearFilters = () => {
    setStatus('all');
    setDocFilter('all');
    setQuery('');
    setPage(1);
  };
  const filtered = status !== 'all' || docFilter !== 'all' || query !== '';

  const COLS: { key: SortKey; label: string }[] = [
    { key: 'name', label: 'לקוח' },
    { key: 'tickets', label: 'כרטיסי עבודה' },
    { key: 'net', label: 'סה״כ לפני מע״מ' },
    { key: 'vat', label: `מע״מ (${Math.round(VAT * 100)}%)` },
    { key: 'gross', label: 'סה״כ כולל מע״מ' },
    { key: 'balance', label: 'יתרה פתוחה' },
    { key: 'avg', label: 'תשלום ממוצע' },
  ];

  return (
    <div className="rep">
      <header className="rep-head">
        <div>
          <h2>דוח לפי לקוחות</h2>
          <p className="rep-sub">סיכום פעילות כספית לפי לקוחות בטווח הנבחר</p>
        </div>
        <div className="foot-spacer" />
        <button className="btn ghost" onClick={() => window.print()}><IconPrint /> הדפסה</button>
        <button className="btn primary" onClick={exportCsv}>⭳ ייצוא לאקסל</button>
      </header>

      {/* filters */}
      <div className="rep-filters">
        <label className="rep-f">
          <span>חיפוש לקוח</span>
          <input value={query} onChange={(e) => { setQuery(e.target.value); setPage(1); }} placeholder="שם לקוח" />
        </label>

        <label className="rep-f">
          <span>סטטוס כרטיס עבודה</span>
          <select value={status} onChange={(e) => { setStatus(e.target.value as Status | 'all'); setPage(1); }}>
            <option value="all">כל הסטטוסים</option>
            {COLUMNS.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>
        </label>

        <label className="rep-f">
          <span>סוג מסמך</span>
          <select value={docFilter} onChange={(e) => { setDocFilter(e.target.value as DocFilter); setPage(1); }}>
            <option value="all">הכל</option>
            <option value="paid">חשבונית מס-קבלה (שולם)</option>
            <option value="open">חשבונית מס (חיוב פתוח)</option>
            <option value="none">ללא מסמך</option>
          </select>
        </label>

        {filtered && (
          <button className="rep-clear" onClick={clearFilters}>✕ נקה סינון</button>
        )}
      </div>

      {/* KPIs */}
      <div className="kpis">
        <Kpi icon={<IconReports />} tone="ok" label="סה״כ הכנסות" sub="כולל מע״מ" value={money(totals.gross)} />
        <Kpi icon={<IconDoc />} tone="slate" label="סה״כ לפני מע״מ" sub="לפני מע״מ" value={money(totals.net)} />
        <Kpi icon={<IconDoc />} tone="warn" label="סה״כ מע״מ" sub={`מע״מ (${Math.round(VAT * 100)}%)`} value={money(totals.vat)} />
        <Kpi icon={<IconTickets />} tone="slate" label="כרטיסי עבודה" sub="מס׳ כרטיסים" value={String(totals.count)} />
        <Kpi icon={<IconCustomers />} tone="slate" label="לקוחות פעילים" sub="סה״כ לקוחות" value={String(totals.customers)} />
        <Kpi icon={<IconReports />} tone="slate" label="ממוצע לעסקה" sub="ממוצע לכרטיס עבודה" value={money(totals.avg)} />
      </div>

      {/* table */}
      <section className="card rep-table-card">
        <h3 className="card-title">פילוח לפי לקוחות ({rows.length})</h3>

        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                {COLS.map((c) => (
                  <th key={c.key} onClick={() => toggleSort(c.key)} className={sort.by === c.key ? 'sorted' : ''}>
                    {c.label}
                    <span className="sort-ar">{sort.by === c.key ? (sort.dir === 1 ? '▲' : '▼') : ''}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {slice.map((r) => (
                <tr key={r.name}>
                  <td>
                    <div className="rep-name">{r.name}</div>
                    <div className="tbl-sub">{r.id}</div>
                  </td>
                  <td>{r.tickets}</td>
                  <td>{money(r.net)}</td>
                  <td>{money(r.vat)}</td>
                  <td className="tbl-amount">{money(r.gross)}</td>
                  <td className={r.balance > 0 ? 'bal-open' : 'bal-clear'}>{money(r.balance)}</td>
                  <td>{money(r.avg)}</td>
                </tr>
              ))}
              {slice.length === 0 && (
                <tr><td colSpan={COLS.length} className="empty-note">לא נמצאו נתונים לטווח שנבחר</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* pagination */}
        <div className="rep-foot">
          <div className="rep-per">
            <span>שורות בעמוד</span>
            <select value={perPage} onChange={(e) => { setPerPage(Number(e.target.value)); setPage(1); }}>
              {[10, 25, 50].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>

          <div className="foot-spacer" />

          <div className="pager">
            <button disabled={current === 1} onClick={() => setPage(current - 1)}>›</button>
            {Array.from({ length: pages }, (_, i) => i + 1).map((n) => (
              <button key={n} className={n === current ? 'on' : ''} onClick={() => setPage(n)}>{n}</button>
            ))}
            <button disabled={current === pages} onClick={() => setPage(current + 1)}>‹</button>
          </div>

          <span className="rep-count">
            {sorted.length === 0 ? '0' : `${(current - 1) * perPage + 1}-${Math.min(current * perPage, sorted.length)}`} מתוך {sorted.length}
          </span>
        </div>
      </section>
    </div>
  );
}

function Kpi({ icon, label, sub, value, tone }: {
  icon: React.ReactNode; label: string; sub: string; value: string; tone: 'ok' | 'warn' | 'slate';
}) {
  return (
    <div className="kpi">
      <div className="kpi-top">
        <span className="kpi-label">{label}</span>
        <span className={`kpi-ic ${tone}`}>{icon}</span>
      </div>
      <div className={`kpi-val ${tone}`}>{value}</div>
      <div className="kpi-sub">{sub}</div>
    </div>
  );
}
