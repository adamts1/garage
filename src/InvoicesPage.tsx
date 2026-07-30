import { useEffect, useMemo, useState } from 'react';
import { listInvoices, subscribeToInvoices, type Invoice } from '@garage/shared';
import {
  IconCar, IconCard, IconCheck, IconCustomers, IconDoc, IconPrint, IconWrench,
} from './icons';
import { printInvoice, warnIfBlocked } from './lib/print';

const shekel = (n: number) =>
  '₪' + n.toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const shekelRound = (n: number) => '₪' + Math.round(n).toLocaleString('he-IL');
const fmt = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString('he-IL') : '-');

const DOC_LABEL: Record<Invoice['docType'], string> = {
  invoice_receipt: 'חשבונית מס-קבלה',
  credit_note: 'חשבונית זיכוי',
};
const STATUS_LABEL: Record<Invoice['status'], string> = {
  issued: 'הופקה',
  cancelled: 'בוטלה',
};

interface Props {
  onOpenTicket: (key: string) => void;
}

/* Invoices are now READ from the stored, immutable invoices table — one row per
   real document iCount issued. This page no longer recomputes anything from live
   tickets (the §3.1 bug): number, VAT and totals are whatever was frozen at
   issue. See docs/PRODUCTION.md §4a. */
export default function InvoicesPage({ onOpenTicket }: Props) {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'all' | Invoice['status']>('all');
  const [docType, setDocType] = useState<'all' | Invoice['docType']>('all');
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      listInvoices()
        .then((rows) => { if (alive) setInvoices(rows); })
        .catch(() => { if (alive) setInvoices([]); })
        .finally(() => { if (alive) setLoading(false); });
    load();
    const off = subscribeToInvoices(load);
    return () => { alive = false; off(); };
  }, []);

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

  // Money view counts issued invoice-receipts only: cancelled docs and credit
  // notes must not inflate "how much did we bill".
  const receipts = invoices.filter((i) => i.docType === 'invoice_receipt');
  const issuedSum = receipts.filter((i) => i.status === 'issued').reduce((s, i) => s + i.total, 0);
  const cancelledCount = receipts.filter((i) => i.status === 'cancelled').length;
  const sumShown = shown.reduce((s, i) => s + i.total, 0);

  const current = invoices.find((i) => i.id === selected) ?? null;
  const filtered = status !== 'all' || docType !== 'all' || query.trim() !== '';

  return (
    <div className="inv">
      <div className="panel-header">
        <div>
          <h2>חשבוניות</h2>
          <p className="inv-sub">מסמכי מס שהופקו - חשבוניות מס - קבלה וזיכויים</p>
        </div>
      </div>

      {/* ---------- KPI row ---------- */}
      <div className="inv-kpis">
        <Kpi
          icon={<IconDoc />} tone="navy"
          value={shekelRound(issuedSum)} label="סה״כ הופק"
          note={`${receipts.filter((i) => i.status === 'issued').length} חשבוניות פעילות`}
        />
        <Kpi
          icon={<IconCheck />} tone="ok"
          value={String(receipts.length)} label="חשבוניות מס-קבלה"
          note="סך המסמכים שהופקו"
        />
        <Kpi
          icon={<IconCard />} tone="danger"
          value={String(cancelledCount)} label="בוטלו"
          note="חשבוניות שבוטלו בזיכוי"
        />
      </div>

      {/* ---------- filters ---------- */}
      <div className="inv-filters">
        <input
          className="inv-search"
          placeholder="חיפוש לפי לקוח, מספר מסמך או כרטיס…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select value={docType} onChange={(e) => setDocType(e.target.value as typeof docType)}>
          <option value="all">כל סוגי המסמכים</option>
          <option value="invoice_receipt">חשבונית מס-קבלה</option>
          <option value="credit_note">חשבונית זיכוי</option>
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
          <option value="all">כל הסטטוסים</option>
          <option value="issued">הופקה</option>
          <option value="cancelled">בוטלה</option>
        </select>
        <button
          className="btn ghost"
          disabled={!filtered}
          onClick={() => { setQuery(''); setStatus('all'); setDocType('all'); }}
        >
          איפוס סינונים
        </button>
      </div>

      {/* ---------- table ---------- */}
      <section className="card">
        {loading ? (
          <div className="ws-empty"><p>טוען חשבוניות…</p></div>
        ) : invoices.length === 0 ? (
          <div className="ws-empty">
            <div className="ws-empty-ic big"><IconDoc /></div>
            <h4>אין עדיין חשבוניות</h4>
            <p>חשבונית מופקת מתוך כרטיס עבודה, לאחר גביית התשלום</p>
          </div>
        ) : shown.length === 0 ? (
          <div className="ws-empty">
            <div className="ws-empty-ic"><IconDoc /></div>
            <h4>לא נמצאו חשבוניות</h4>
            <p>אין חשבוניות שתואמות את הסינון</p>
          </div>
        ) : (
          <>
            <table className="works-table inv-table">
              <thead>
                <tr>
                  <th style={{ width: 96 }}>מספר</th>
                  <th>לקוח</th>
                  <th style={{ width: 104 }}>תאריך</th>
                  <th style={{ width: 170 }}>סוג מסמך</th>
                  <th style={{ width: 110 }}>סכום כולל</th>
                  <th style={{ width: 120 }}>סטטוס</th>
                  <th style={{ width: 130 }}>מספר הקצאה</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((i) => (
                  <tr
                    key={i.id}
                    className={i.id === selected ? 'is-selected' : ''}
                    onClick={() => setSelected(i.id === selected ? null : i.id)}
                  >
                    <td><b className="inv-num">{i.docnum}</b></td>
                    <td>{i.customerName ?? '-'}</td>
                    <td className="muted-cell">{fmt(i.issuedAt)}</td>
                    <td className="muted-cell">{DOC_LABEL[i.docType]}</td>
                    <td><strong>{shekel(i.total)}</strong></td>
                    <td><StatusPill status={i.status} /></td>
                    <td className="muted-cell">{i.allocationNumber ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={4}>{filtered ? 'סה״כ מסונן' : 'סה״כ'}</td>
                  <td><strong>{shekel(sumShown)}</strong></td>
                  <td colSpan={2} className="muted-cell">{shown.length} מתוך {invoices.length}</td>
                </tr>
              </tfoot>
            </table>
            <p className="inv-hint">לחץ על שורה כדי לראות את פרטי החשבונית</p>
          </>
        )}
      </section>

      {/* ---------- detail ---------- */}
      {current && (
        <section className="card inv-detail">
          <div className="tp-works-head">
            <h3 className="card-title"><IconDoc /> {DOC_LABEL[current.docType]} {current.docnum}</h3>
            <StatusPill status={current.status} />
          </div>

          <div className="inv-detail-grid">
            <dl className="kv">
              <dt><IconCustomers /> לקוח</dt><dd><b>{current.customerName ?? '-'}</b></dd>
              {current.customerIdNumber && (<><dt><IconDoc /> ת״ז / ח״פ</dt><dd>{current.customerIdNumber}</dd></>)}
              <dt><IconDoc /> סוג מסמך</dt><dd>{DOC_LABEL[current.docType]}</dd>
              <dt><IconCard /> תאריך הפקה</dt><dd>{fmt(current.issuedAt)}</dd>
              <dt><IconDoc /> מספר הקצאה</dt>
              <dd>{current.allocationNumber ?? <span className="kv-empty">-</span>}</dd>
              <dt><IconCard /> אמצעי תשלום</dt>
              <dd>{current.payMethod ?? <span className="kv-empty">-</span>}</dd>
            </dl>

            <div className="sum inv-sum">
              <div>
                <span>סכום לפני מע״מ</span>
                <b>{shekel(current.subtotal)}</b>
              </div>
              <div>
                <span>מע״מ ({Math.round(current.vatRate * 100)}%)</span>
                <b>{shekel(current.vat)}</b>
              </div>
              <div className="grand"><span>סה״כ</span><b>{shekel(current.total)}</b></div>
            </div>
          </div>

          {current.lines.length > 0 && (
            <table className="works-table" style={{ marginTop: 16 }}>
              <thead>
                <tr><th>פירוט</th><th style={{ width: 80 }}>כמות</th><th style={{ width: 110 }}>מחיר</th><th style={{ width: 120 }}>סה״כ</th></tr>
              </thead>
              <tbody>
                {current.lines.map((l, idx) => (
                  <tr key={idx}>
                    <td>{l.desc}</td>
                    <td className="muted-cell">{l.qty}</td>
                    <td className="muted-cell">{shekel(l.unit_price)}</td>
                    <td><strong>{shekel(l.line_total)}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div className="inv-actions">
            {current.ticketKey && (
              <button className="btn primary" onClick={() => onOpenTicket(current.ticketKey!)}>
                <IconWrench /> פתח כרטיס עבודה #{current.ticketKey.split('-')[1]}
              </button>
            )}
            {/* The stored row, laid out as a document. Printing the page itself
                gave you the sidebar, the KPI cards and the filter bar around a
                table — and nothing at all when no provider PDF existed. */}
            <button className="btn ghost" onClick={() => warnIfBlocked(printInvoice(current))}>
              <IconPrint /> הדפס עותק
            </button>
            {current.pdfUrl && (
              <a className="btn ghost" href={current.pdfUrl} target="_blank" rel="noreferrer">
                <IconDoc /> המסמך הרשמי (PDF)
              </a>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: Invoice['status'] }) {
  const cls = status === 'issued' ? 'paid' : 'overdue';
  return <span className={`inv-pill ${cls}`}>{STATUS_LABEL[status]}</span>;
}

function Kpi({ icon, tone, value, label, note }: {
  icon: React.ReactNode; tone: string; value: string; label: string; note: string;
}) {
  return (
    <div className="card inv-kpi">
      <span className={`inv-kpi-ic ${tone}`}>{icon}</span>
      <div>
        <b className={`inv-kpi-val ${tone}`} dir="ltr">{value}</b>
        <span className="inv-kpi-label">{label}</span>
        <span className="inv-kpi-note">{note}</span>
      </div>
    </div>
  );
}
