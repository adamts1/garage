import { useEffect, useState, type CSSProperties, type Dispatch, type SetStateAction } from 'react';
import CloseTicketDrawer from './CloseTicketDrawer';
import WorksStep from './WorksStep';
import { VAT, partsTotal, type PartDef, type TicketWork, type WorkDef } from '@garage/shared';
import { COLUMNS, TEAM, type Ticket } from '@garage/shared';
import { listTicketPhotos, subscribeToTicketPhotos, type TicketPhoto } from '@garage/shared';
import {
  IconCar, IconCard, IconChat, IconCheck, IconClock, IconCustomers,
  IconDoc, IconPhoto, IconPrint, IconTrash, IconWhatsapp, IconWrench,
} from './icons';

const shekel = (n: number) => '₪' + n.toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 050-1234567 → 972501234567 (wa.me wants digits only, with country code) */
const waNumber = (phone?: string) => {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('972')) return digits;
  return '972' + digits.replace(/^0/, '');
};

/* wa.me carries text only - there is no attachment parameter - so photos travel as
   links. The bucket is public, so they open without a login. Capped at three: ten
   URLs would bury the price the customer is meant to be reading. */
const WA_PHOTO_LIMIT = 3;
const photoLines = (photos: TicketPhoto[]) => {
  if (!photos.length) return [];
  const shown = photos.slice(0, WA_PHOTO_LIMIT);
  const rest = photos.length - shown.length;
  return [
    '',
    photos.length > 1 ? 'תמונות מהמוסך:' : 'תמונה מהמוסך:',
    ...shown.map((p) => p.url),
    ...(rest > 0 ? [`(ועוד ${rest} תמונות בכרטיס)`] : []),
  ];
};

const waMessage = (t: Ticket, total: number, photos: TicketPhoto[] = []) => {
  const lines = [
    `שלום ${t.customer},`,
    `הרכב ${t.car} (${t.plate}) מוכן לאיסוף`,
    '',
    'העבודות שבוצעו:',
    ...(t.works ?? []).map((w) => `• ${w.name}`),
    '',
    `סה״כ לתשלום: ${shekel(total)}`,
    t.paid ? `שולם ב${t.payMethod} - תודה!` : 'התשלום יתבצע בעת האיסוף.',
    ...photoLines(photos),
    '',
    'מוסך אי-תן · נשמח לראותך',
  ];
  return lines.filter((l) => l !== undefined).join('\n');
};

interface Props {
  ticket: Ticket;
  setTickets: Dispatch<SetStateAction<Ticket[]>>;
  catalog: WorkDef[];
  addToCatalog: (def: WorkDef) => void;
  parts: PartDef[];
  addToParts: (part: PartDef) => void;
  onBack: () => void;
}

const STEPS = [
  { id: 'tp-details', label: 'פרטי לקוח ורכב' },
  { id: 'tp-works', label: 'עבודות ופריטים' },
  { id: 'tp-summary', label: 'סיכום וסגירה' },
];

/** '-' for anything the intake form never filled in, so blanks read as blank, not as data. */
const Val = ({ children }: { children?: string | number | null }) =>
  children === undefined || children === null || children === ''
    ? <span className="kv-empty">-</span>
    : <>{children}</>;

export default function TicketPage({
  ticket, setTickets, catalog, addToCatalog, parts, addToParts, onBack,
}: Props) {
  const [note, setNote] = useState('');
  const [closing, setClosing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [step, setStep] = useState('tp-details');
  /* Photos are taken on the phone; the board is read-only. The realtime subscription
     is what makes a photo appear here seconds after the mechanic shoots it. */
  const [photos, setPhotos] = useState<TicketPhoto[]>([]);
  const [lightbox, setLightbox] = useState<TicketPhoto | null>(null);
  const works = ticket.works ?? [];
  const itemCount = works.reduce((s, w) => s + w.items.length, 0);

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

  const patch = (p: Partial<Ticket>) =>
    setTickets((prev) => prev.map((t) => (t.k === ticket.k ? { ...t, ...p } : t)));

  const setWorks = (next: TicketWork[]) => {
    const labour = next.reduce((s, w) => s + w.labor, 0);
    const items = next.reduce((s, w) => s + partsTotal(w), 0);
    const total = Math.round((labour + items) * (1 + VAT));
    patch({ works: next, amount: total, subtasks: next.map((w) => w.name) });
  };

  const labour = works.reduce((s, w) => s + w.labor, 0);
  const items = works.reduce((s, w) => s + partsTotal(w), 0);
  const vat = (labour + items) * VAT;
  const total = labour + items + vat;

  const column = COLUMNS.find((c) => c.id === ticket.st);
  // work finished (ready for pickup OR paid) - enough to notify the customer
  const closed = ticket.st === 'done' || ticket.st === 'paid';
  // actually settled. Only a paid ticket blocks further charging; a ticket sitting
  // in "מוכן לאיסוף" is finished but still owes money, so payment stays open.
  const settled = ticket.paid === true || ticket.st === 'paid';
  const wa = waNumber(ticket.phone);

  return (
    <div className="tp">
      <header className="tp-head">
        <div className="tp-head-bar">
          <div>
            <div className="tp-title">
              <h2>כרטיס עבודה #{ticket.k.split('-')[1]}</h2>
              <span
                className="tp-status"
                style={{ '--dot': column?.dot } as CSSProperties}
              >
                <i className="tp-status-dot" />
                {column?.title}
              </span>
            </div>
            <div className="tp-sub">
              <span>נוצר: <Val>{ticket.createdAt}</Val></span>
              <span className="tp-sep">·</span>
              <span>יעד: <Val>{ticket.due}</Val></span>
              <span className="tp-sep">·</span>
              <span>עובד: {TEAM[ticket.who].n}</span>
            </div>
          </div>

          <div className="foot-spacer" />

          <button className="btn ghost" onClick={onBack}>
             חזרה לרשימת כרטיסים <span className="arrow">←</span>
          </button>
        </div>

        <nav className="tabs tp-tabs">
          {STEPS.map((s, i) => (
            <button
              key={s.id}
              type="button"
              className={`tab${step === s.id ? ' on' : ''}`}
              onClick={() => { setStep(s.id); scrollTo(s.id); }}
            >
              <span className="tab-num">
                {step === s.id ? <IconCheck /> : i + 1}
              </span>
              {s.label}
            </button>
          ))}
        </nav>
      </header>

      <div className="tp-grid">
        {/* ------- main column ------- */}
        <div className="tp-main">
          <div className="tp-row" id="tp-details">
            <section className="card">
              <h3 className="card-title"><IconCar /> פרטי רכב</h3>
              <dl className="kv">
                <dt>מספר רישוי</dt>
                <dd>{ticket.plate ? <span className="plate">{ticket.plate}</span> : <Val>{null}</Val>}</dd>
                <dt>דגם</dt><dd><Val>{ticket.car}</Val></dd>
                <dt>שנת ייצור</dt><dd><Val>{ticket.year}</Val></dd>
                <dt>ק״מ</dt><dd><Val>{ticket.km ? `${ticket.km} ק״מ` : null}</Val></dd>
              </dl>
            </section>

            <section className="card">
              <h3 className="card-title"><IconCustomers /> פרטי לקוח</h3>
              <dl className="kv">
                <dt>שם</dt><dd><b>{ticket.customer}</b></dd>
                <dt>טלפון</dt>
                <dd>
                  {ticket.phone
                    ? <a className="kv-link" href={`tel:${ticket.phone}`} dir="ltr">{ticket.phone}</a>
                    : <Val>{null}</Val>}
                </dd>
                <dt>אימייל</dt>
                <dd>
                  {ticket.email
                    ? <a className="kv-link" href={`mailto:${ticket.email}`} dir="ltr">{ticket.email}</a>
                    : <Val>{null}</Val>}
                </dd>
                <dt>כתובת</dt><dd><Val>{ticket.address}</Val></dd>
              </dl>
            </section>
          </div>

          <section className="card" id="tp-works">
            <div className="tp-works-head">
              <h3 className="card-title"><IconWrench /> עבודות ופריטים</h3>
              <span className="card-count">{works.length} עבודות · {itemCount} פריטים</span>
            </div>

            <WorksStep
              works={works}
              setWorks={setWorks}
              catalog={catalog}
              addToCatalog={addToCatalog}
              parts={parts}
              addToParts={addToParts}
              combinedEmpty      /* one toolbox empty-state instead of two */
            />
          </section>

          <section className="card" id="tp-photos">
            <div className="tp-works-head">
              <h3 className="card-title"><IconPhoto /> תמונות</h3>
              <span className="card-count">{photos.length} תמונות</span>
            </div>

            {photos.length === 0 ? (
              <p className="photo-empty">אין תמונות בכרטיס. תמונות מצולמות מהאפליקציה בנייד.</p>
            ) : (
              <div className="photo-grid">
                {photos.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="photo-cell"
                    onClick={() => setLightbox(p)}
                    title={p.caption || p.createdAt}
                  >
                    <img src={p.url} alt={p.caption || `תמונה מכרטיס ${ticket.k}`} loading="lazy" />
                  </button>
                ))}
              </div>
            )}
          </section>

          <div className="tp-row">
            <section className="card">
              <h3 className="card-title"><IconClock /> היסטוריית פעולות</h3>
              <div className="log">
                <div className="log-row">
                  <div className="log-when">{ticket.createdAt ?? '-'}</div>
                  <div className="log-who">{TEAM[ticket.who].n}</div>
                  <div className="log-what">כרטיס נפתח</div>
                </div>
                {works.length > 0 && (
                  <div className="log-row">
                    <div className="log-when">-</div>
                    <div className="log-who">{TEAM[ticket.who].n}</div>
                    <div className="log-what">{works.length} עבודות נוספו לכרטיס</div>
                  </div>
                )}
              </div>
            </section>

            <section className="card">
              <h3 className="card-title"><IconChat /> הערות פנימיות</h3>
              <textarea
                className="note-box"
                placeholder="הוסף הערה פנימית..."
                value={note || ticket.notes || ''}
                onChange={(e) => setNote(e.target.value)}
                onBlur={() => patch({ notes: note })}
              />
            </section>
          </div>
        </div>

        {/* ------- side column ------- */}
        <aside className="tp-side" id="tp-summary">
          <section className="card">
            <h3 className="card-title"><IconDoc /> סיכום</h3>
            <div className="sum">
              <div>
                <span>סה״כ עבודות <i className="sum-n">{works.length}</i></span>
                <b>{shekel(labour)}</b>
              </div>
              <div>
                <span>סה״כ פריטים <i className="sum-n">{itemCount}</i></span>
                <b>{shekel(items)}</b>
              </div>
              <div className="sum-sub">
                <span>סכום ביניים</span><b>{shekel(labour + items)}</b>
              </div>
              <div><span>מע״מ ({Math.round(VAT * 100)}%)</span><b>{shekel(vat)}</b></div>
              <div className="grand"><span>סה״כ לתשלום</span><b>{shekel(total)}</b></div>
            </div>
          </section>

          <section className="card">
            <h3 className="card-title"><IconCard /> מצב חיוב</h3>
            <div className={`bill-note${ticket.paid ? ' ok' : ''}`}>
              {ticket.doc
                ? (ticket.paid ? 'שולם - הופקה חשבונית מס-קבלה' : 'הופקה חשבונית מס - יתרה פתוחה')
                : 'לא הונפק מסמך / לא שולם'}
            </div>
            <dl className="kv">
              <dt>סטטוס</dt>
              <dd>
                <span className="prio-dot" style={{ background: column?.dot }} /> {column?.title}
              </dd>
              <dt>תשלום</dt>
              <dd>{ticket.paid ? `שולם · ${ticket.payMethod}` : ticket.doc ? 'חיוב פתוח' : '-'}</dd>
              <dt>מסמך</dt><dd>{ticket.doc ?? '-'}</dd>
            </dl>

            <button
              className="btn primary block"
              onClick={() => setClosing(true)}
              disabled={settled}
            >
              <IconCard /> {settled
                ? 'שולם · הכרטיס סגור'
                : ticket.st === 'done'
                  ? 'גבה תשלום'          // ready for pickup, still owes money
                  : 'סגור כרטיס וחייב לקוח'}
            </button>
            {closed && (
              wa ? (
                <a
                  className="btn whatsapp block"
                  href={`https://wa.me/${wa}?text=${encodeURIComponent(waMessage(ticket, total, photos))}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <IconWhatsapp /> שלח הודעה ללקוח
                </a>
              ) : (
                <button className="btn ghost block" disabled title="אין מספר טלפון ללקוח">
                  <IconWhatsapp /> אין טלפון ללקוח
                </button>
              )
            )}
            <button className="btn ghost block" onClick={() => window.print()}>
              <IconPrint /> הדפס כרטיס עבודה
            </button>
          </section>
        </aside>
      </div>

      {closing && (
        <CloseTicketDrawer
          ticket={ticket}
          total={total}
          onClose={() => setClosing(false)}
          onConfirm={(r) => {
            patch({
              // paid -> "שולם"; closed with an open balance -> stays "מוכן לאיסוף"
              st: r.paid ? 'paid' : 'done',
              done: ticket.subtasks.length,
              paid: r.paid,
              payMethod: r.method,
              doc: r.doc,
              reference: r.reference,
            });
            setClosing(false);
            setToast(r.paid
              ? `התשלום נקלט · ${r.method} · ${shekel(total)} - הופק ${r.doc}`
              : `הכרטיס נסגר עם יתרה פתוחה · ${shekel(total)}`);
            setTimeout(() => setToast(null), 5000);
          }}
        />
      )}

      {lightbox && (
        <div
          className="photo-lightbox"
          role="dialog"
          aria-modal="true"
          onClick={() => setLightbox(null)}
        >
          <img src={lightbox.url} alt={lightbox.caption || 'תמונה מהכרטיס'} />
          <div className="photo-lightbox-bar" onClick={(e) => e.stopPropagation()}>
            <span>{lightbox.caption || lightbox.createdAt}</span>
            <button className="btn ghost" onClick={() => setLightbox(null)}>סגור</button>
          </div>
        </div>
      )}

      {toast && (
        <div className="toast" role="status">
          <span className="toast-ic"><IconCheck /></span>
          <div className="toast-body">{toast}</div>
          <button className="toast-x" onClick={() => setToast(null)}>✕</button>
        </div>
      )}

      <footer className="tp-foot">
        <button
          className="btn danger"
          onClick={() => {
            setTickets((prev) => prev.filter((t) => t.k !== ticket.k));
            onBack();
          }}
        >
          <IconTrash /> בטל כרטיס
        </button>
        <div className="foot-spacer" />
        <button className="btn ghost" onClick={onBack}>סגור</button>
        <button className="btn primary lg" onClick={() => scrollTo('tp-works')}>
          שמור <span className="arrow">←</span>
        </button>
      </footer>
    </div>
  );
}

function scrollTo(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
