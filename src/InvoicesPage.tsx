import { useMemo, useState } from 'react';
import { VAT, partsTotal } from './catalog';
import type { Ticket } from './board-data';
import {
  IconCar, IconCard, IconCheck, IconClock, IconCustomers,
  IconDoc, IconPrint, IconWrench,
} from './icons';

const shekel = (n: number) =>
  '₪' + n.toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const shekelRound = (n: number) => '₪' + Math.round(n).toLocaleString('he-IL');

/** an unpaid invoice is late once it is older than this */
const NET_DAYS = 14;

type InvStatus = 'paid' | 'due' | 'overdue';

const STATUS_LABEL: Record<InvStatus, string> = {
  paid: 'שולם',
  due: 'ממתין לתשלום',
  overdue: 'באיחור',
};

export interface Invoice {
  number: number;
  ticketKey: string;
  customer: string;
  car: string;
  plate: string;
  type: string;               // 'חשבונית מס-קבלה' | 'חשבונית מס (חיוב פתוח)'
  status: InvStatus;
  issued?: Date;
  issuedLabel: string;
  dueLabel: string;
  subtotal: number;
  vat: number;
  total: number;
  method?: string;
  reference?: string;
  workCount: number;
  itemCount: number;
}

const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);
const fmt = (d?: Date) => (d ? d.toLocaleDateString('he-IL') : '—');

/**
 * An invoice is a *view* of a billed ticket — CloseTicketDrawer is what stamps
 * doc / paid / payMethod / reference onto it. A ticket with no doc was never
 * billed, so it has no invoice.
 */
export function invoiceFrom(t: Ticket, now: Date): Invoice {
  const works = t.works ?? [];
  const labour = works.reduce((s, w) => s + w.labor, 0);
  const parts = works.reduce((s, w) => s + partsTotal(w), 0);

  // prefer the live works; fall back to the stored total (which already includes VAT)
  const subtotal = labour + parts > 0
    ? labour + parts
    : (t.amount ? t.amount / (1 + VAT) : 0);
  const vat = subtotal * VAT;
  const total = subtotal + vat;

  const issued = t.createdAtISO ? new Date(t.createdAtISO) : undefined;
  const due = issued ? addDays(issued, NET_DAYS) : undefined;

  const status: InvStatus = t.paid
    ? 'paid'
    : due && now > due
      ? 'overdue'
      : 'due';

  return {
    number: 10000 + (Number(t.k.split('-')[1]) || 0),
    ticketKey: t.k,
    customer: t.customer,
    car: t.car,
    plate: t.plate,
    type: t.doc ?? '—',
    status,
    issued,
    issuedLabel: fmt(issued),
    dueLabel: fmt(due),
    subtotal,
    vat,
    total,
    method: t.payMethod,
    reference: t.reference,
    workCount: works.length,
    itemCount: works.reduce((s, w) => s + w.items.length, 0),
  };
}

interface Props {
  tickets: Ticket[];
  onOpenTicket: (key: string) => void;
}

export default function InvoicesPage({ tickets, onOpenTicket }: Props) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'all' | InvStatus>('all');
  const [type, setType] = useState('all');
  const [selected, setSelected] = useState<number | null>(null);

  const invoices = useMemo(() => {
    const now = new Date();
    return tickets
      .filter((t) => t.doc)                       // billed tickets only
      .map((t) => invoiceFrom(t, now))
      .sort((a, b) => (b.issued?.getTime() ?? 0) - (a.issued?.getTime() ?? 0));
  }, [tickets]);

  const types = useMemo(
    () => Array.from(new Set(invoices.map((i) => i.type))),
    [invoices],
  );

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return invoices.filter((i) => {
      if (status !== 'all' && i.status !== status) return false;
      if (type !== 'all' && i.type !== type) return false;
      if (!q) return true;
      return (
        String(i.number).includes(q) ||
        i.customer.toLowerCase().includes(q) ||
        i.plate.toLowerCase().includes(q) ||
        i.car.toLowerCase().includes(q)
      );
    });
  }, [invoices, query, status, type]);

  const sum = (list: Invoice[]) => list.reduce((s, i) => s + i.total, 0);
  const by = (s: InvStatus) => invoices.filter((i) => i.status === s);

  const current = shown.find((i) => i.number === selected)
    ?? invoices.find((i) => i.number === selected)
    ?? null;

  const filtered = status !== 'all' || type !== 'all' || query.trim() !== '';

  return (
    <div className="inv">
      <div className="panel-header">
        <div>
          <h2>חשבוניות</h2>
          <p className="inv-sub">ניהול חשבוניות ומסמכי חיוב</p>
        </div>
      </div>

      {/* ---------- KPI row ---------- */}
      <div className="inv-kpis">
        <Kpi
          icon={<IconDoc />} tone="navy"
          value={shekelRound(sum(invoices))} label="סה״כ חשבוניות"
          note={`${invoices.length} חשבוניות`}
        />
        <Kpi
          icon={<IconClock />} tone="warn"
          value={shekelRound(sum(by('due')))} label="ממתין לתשלום"
          note={`${by('due').length} חשבוניות`}
        />
        <Kpi
          icon={<IconCheck />} tone="ok"
          value={shekelRound(sum(by('paid')))} label="שולם"
          note={`${by('paid').length} חשבוניות`}
        />
        <Kpi
          icon={<IconCard />} tone="danger"
          value={shekelRound(sum(by('overdue')))} label="באיחור"
          note={`${by('overdue').length} חשבוניות · מעל ${NET_DAYS} ימים`}
        />
      </div>

      {/* ---------- filters ---------- */}
      <div className="inv-filters">
        <input
          className="inv-search"
          placeholder="חיפוש לפי לקוח, רכב או מספר מסמך…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select value={type} onChange={(e) => setType(e.target.value)}>
          <option value="all">כל סוגי המסמכים</option>
          {types.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value as 'all' | InvStatus)}>
          <option value="all">כל הסטטוסים</option>
          <option value="paid">שולם</option>
          <option value="due">ממתין לתשלום</option>
          <option value="overdue">באיחור</option>
        </select>
        <button
          className="btn ghost"
          disabled={!filtered}
          onClick={() => { setQuery(''); setStatus('all'); setType('all'); }}
        >
          איפוס סינונים
        </button>
      </div>

      {/* ---------- table ---------- */}
      <section className="card">
        {invoices.length === 0 ? (
          <div className="ws-empty">
            <div className="ws-empty-ic big"><IconDoc /></div>
            <h4>אין עדיין חשבוניות</h4>
            <p>חשבונית נוצרת כשסוגרים כרטיס עבודה ומחייבים את הלקוח</p>
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
                  <th style={{ width: 190 }}>רכב</th>
                  <th style={{ width: 104 }}>תאריך</th>
                  <th style={{ width: 170 }}>סוג מסמך</th>
                  <th style={{ width: 110 }}>סכום כולל</th>
                  <th style={{ width: 130 }}>סטטוס</th>
                  <th style={{ width: 120 }}>אמצעי תשלום</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((i) => (
                  <tr
                    key={i.number}
                    className={i.number === selected ? 'is-selected' : ''}
                    onClick={() => setSelected(i.number === selected ? null : i.number)}
                  >
                    <td><b className="inv-num">{i.number}</b></td>
                    <td>{i.customer}</td>
                    <td>
                      <div className="inv-car">
                        {i.car}
                        {i.plate && <span className="plate sm">{i.plate}</span>}
                      </div>
                    </td>
                    <td className="muted-cell">{i.issuedLabel}</td>
                    <td className="muted-cell">{i.type}</td>
                    <td><strong>{shekel(i.total)}</strong></td>
                    <td><StatusPill status={i.status} /></td>
                    <td className="muted-cell">{i.method ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={5}>{filtered ? 'סה״כ מסונן' : 'סה״כ'}</td>
                  <td><strong>{shekel(sum(shown))}</strong></td>
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
            <h3 className="card-title"><IconDoc /> חשבונית {current.number}</h3>
            <StatusPill status={current.status} />
          </div>

          <div className="inv-detail-grid">
            <dl className="kv">
              <dt><IconCustomers /> לקוח</dt><dd><b>{current.customer}</b></dd>
              <dt><IconCar /> רכב</dt>
              <dd>{current.car}{current.plate ? ` · ${current.plate}` : ''}</dd>
              <dt><IconDoc /> סוג מסמך</dt><dd>{current.type}</dd>
              <dt><IconClock /> תאריך הנפקה</dt><dd>{current.issuedLabel}</dd>
              <dt><IconClock /> תאריך פירעון</dt><dd>{current.dueLabel}</dd>
              <dt><IconCard /> אמצעי תשלום</dt>
              <dd>{current.method ?? <span className="kv-empty">—</span>}</dd>
              <dt><IconDoc /> אסמכתא</dt>
              <dd>{current.reference ?? <span className="kv-empty">—</span>}</dd>
            </dl>

            <div className="sum inv-sum">
              <div>
                <span>סכום לפני מע״מ <i className="sum-n">{current.workCount} עבודות</i></span>
                <b>{shekel(current.subtotal)}</b>
              </div>
              <div>
                <span>מע״מ ({Math.round(VAT * 100)}%)</span>
                <b>{shekel(current.vat)}</b>
              </div>
              <div className="grand"><span>סה״כ לתשלום</span><b>{shekel(current.total)}</b></div>
            </div>
          </div>

          <div className="inv-actions">
            <button className="btn primary" onClick={() => onOpenTicket(current.ticketKey)}>
              <IconWrench /> פתח כרטיס עבודה #{current.ticketKey.split('-')[1]}
            </button>
            <button className="btn ghost" onClick={() => window.print()}>
              <IconPrint /> הדפס חשבונית
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: InvStatus }) {
  return <span className={`inv-pill ${status}`}>{STATUS_LABEL[status]}</span>;
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
