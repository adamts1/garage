import { useState } from 'react';
import Board from './Board';
import CustomersPage from './CustomersPage';
import ItemsPage from './ItemsPage';
import ReportsPage from './ReportsPage';
import SetupNotice from './SetupNotice';
import TicketPage from './TicketPage';
import WorksStep from './WorksStep';
import { isConfigured } from './lib/supabase';
import { useTickets } from './lib/useTickets';
import { PARTS_CATALOG, WORK_CATALOG, worksSummary, type PartDef, type TicketWork, type WorkDef } from './catalog';
import InvoicesPage from './InvoicesPage';
import { IconBoard, IconCar, IconCustomers, IconDoc, IconParts, IconPin, IconReports } from './icons';
import {
  COLUMNS, EPICS, PRIORITIES, TEAM, TYPES,
  type Priority, type Ticket,
} from './board-data';

interface TicketForm {
  customerSearch: string;
  customerName: string;
  customerPhone: string;
  customerType: string;
  address: string;
  email: string;
  city: string;
  zip: string;
  licensePlate: string;
  manufacturer: string;
  model: string;
  year: string;
  km: string;
  keyReceived: boolean;
  technician: keyof typeof TEAM;
  targetDate: string;
  priority: Priority;
  epic: keyof typeof EPICS;
  type: keyof typeof TYPES;
  points: number;
}

const emptyForm: TicketForm = {
  customerSearch: '',
  customerName: '',
  customerPhone: '',
  customerType: 'פרטי',
  address: '',
  email: '',
  city: '',
  zip: '',
  licensePlate: '',
  manufacturer: '',
  model: '',
  year: '',
  km: '',
  keyReceived: false,
  technician: 'dk',
  targetDate: '',
  priority: 'med',
  epic: 'service',
  type: 'job',
  points: 3,
};

const navItems = [
  { name: 'לוח בקרה', Icon: IconBoard },
  { name: 'חשבוניות', Icon: IconDoc },
  { name: 'לקוחות', Icon: IconCustomers },
  { name: 'פריטים', Icon: IconParts },
  { name: 'דוחות', Icon: IconReports },
];
const MAKERS = ['טויוטה', 'יונדאי', 'מאזדה', 'קיה', 'פורד', 'סקודה', 'פיאט', 'הונדה', 'שברולט', 'פולקסווגן'];
const YEARS = Array.from({ length: 22 }, (_, i) => 2026 - i);

const shekel = (n: number) => '₪' + n.toLocaleString('he-IL');

function App() {
  const [active, setActive] = useState('לוח בקרה');
  const { tickets, setTickets, loading, error } = useTickets();   // Supabase-backed, live
  const [showForm, setShowForm] = useState(false);
  const [tab, setTab] = useState<1 | 2>(1);   // which half of the form is showing
  const [openTicket, setOpenTicket] = useState<string | null>(null);
  const [form, setForm] = useState<TicketForm>(emptyForm);
  const [works, setWorks] = useState<TicketWork[]>([]);
  const [catalog, setCatalog] = useState<WorkDef[]>(WORK_CATALOG);
  const [partsCatalog, setPartsCatalog] = useState<PartDef[]>(PARTS_CATALOG);

  // sidebar: a narrow rail that expands on hover, unless pinned open
  const [pinned, setPinned] = useState(false);
  const [hovered, setHovered] = useState(false);
  const expanded = pinned || hovered;

  const openForm = () => {
    setForm(emptyForm);
    setWorks([]);
    setShowForm(true);
  };

  const closeForm = () => setShowForm(false);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const maxKey = tickets.reduce((max, t) => Math.max(max, Number(t.k.split('-')[1]) || 0), 0);
    const maxJob = tickets.reduce((max, t) => Math.max(max, Number(t.job.split('-')[1]) || 0), 0);

    // each chosen work becomes a subtask, so the card's progress bar tracks real work
    const subtasks = works.map((w) => w.name);

    const ticket: Ticket = {
      k: `GAR-${maxKey + 1}`,
      st: 'todo',
      type: form.type,
      epic: form.epic,
      prio: form.priority,
      pts: form.points,
      who: form.technician,
      job: `W-${maxJob + 1}`,
      title: works.length
        ? works.map((w) => w.name).join(' + ')   // the works are what the ticket is about
        : 'כרטיס חדש',
      plate: form.licensePlate || '-',
      car: [form.manufacturer, form.model, form.year].filter(Boolean).join(' ') || '-',
      customer: form.customerName || 'לקוח מזדמן',
      amount: worksSummary(works).total,
      done: 0,
      subtasks,
      due: form.targetDate ? form.targetDate.split('-').reverse().join('/') : '-',
      flags: [
        ...(form.customerType === 'עסקי' ? ['עסקי'] : []),
        ...(form.keyReceived ? ['מפתח התקבל'] : []),
        'חדש',
      ],
      works,
      phone: form.customerPhone,
      email: form.email,
      address: [form.address, form.city].filter(Boolean).join(', '),
      km: form.km,
      year: form.year,
      createdAt: new Date().toLocaleDateString('he-IL'),
    };

    setTickets((prev) => [ticket, ...prev]);
    setWorks([]);
    setForm(emptyForm);
    closeForm();
    setActive('לוח בקרה'); // land on the board so you see the new ticket
  };

  const set = <K extends keyof TicketForm>(key: K, value: TicketForm[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  return (
    <div className={`app-shell${expanded ? '' : ' rail'}`}>
      <aside
        className={`sidebar${expanded ? '' : ' is-rail'}`}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <div className="brand">
          <div className="brand-logo">מ</div>
          {expanded && (
            <>
              <div>
                <div className="brand-name">מערכת מוסך</div>
                <div className="brand-subtitle">לוח ניהול</div>
              </div>
              <button
                className={`pin${pinned ? ' on' : ''}`}
                onClick={() => setPinned(!pinned)}
                title={pinned ? 'בטל נעיצה - הסרגל יתכווץ' : 'נעץ את הסרגל פתוח'}
              >
                <IconPin filled={pinned} />
              </button>
            </>
          )}
        </div>
        <nav className="nav-list">
          {navItems.map((item) => (
            <button
              key={item.name}
              className={item.name === active ? 'nav-item active' : 'nav-item'}
              onClick={() => { setActive(item.name); setShowForm(false); setOpenTicket(null); }}
              title={item.name}
            >
              <span className="nav-icon"><item.Icon /></span>
              {expanded && <span className="nav-label">{item.name}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          {expanded ? (
            <>
              <div className="status-badge">פתוח</div>
              <div className="footer-note">{tickets.length} כרטיסים פעילים</div>
            </>
          ) : (
            <div className="status-dot" title={`${tickets.length} כרטיסים פעילים`} />
          )}
        </div>
      </aside>

      <main className="main-content">
        <section className="panel">
          {error && <div className="db-error">שגיאת Supabase: {error}</div>}

          {!isConfigured ? (
            <SetupNotice />
          ) : loading ? (
            <div className="db-loading">טוען נתונים מ‑Supabase…</div>
          ) : showForm ? (
            <form
              className="intake-form"
              onSubmit={onSubmit}
              onKeyDown={(e) => {
                // Enter belongs to the tables' inputs - it must not submit the ticket
                if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') {
                  e.preventDefault();
                }
              }}
            >
              <div className="form-head">
                <h2 className="form-title">כרטיס עבודה חדש</h2>
                <div className="foot-spacer" />
                <div className="tabs">
                  <button
                    type="button"
                    className={`tab${tab === 1 ? ' on' : ''}`}
                    onClick={() => { setTab(1); document.getElementById('sec-details')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}
                  >
                    <span className="tab-num">1</span> פרטי לקוח ורכב
                  </button>
                  <button
                    type="button"
                    className={`tab${tab === 2 ? ' on' : ''}`}
                    onClick={() => { setTab(2); document.getElementById('sec-works')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}
                  >
                    <span className="tab-num">2</span> עבודות ופריטים
                  </button>
                </div>
                <button type="button" className="btn ghost" onClick={closeForm}>
                  ← חזרה ללוח
                </button>
              </div>

              <div className="step1-grid" id="sec-details">
              <div className="form-section span-2 search-wrap">
                <input
                  type="text"
                  placeholder="חיפוש לקוח / רכב / טלפון"
                  className="search-input"
                  value={form.customerSearch}
                  onChange={(e) => set('customerSearch', e.target.value)}
                />
              </div>

              <div className="form-section">
                <h3 className="section-title card-title">
                  <IconCustomers /> פרטי לקוח
                </h3>
                <div className="form-row">
                  <div className="form-group">
                    <input type="text" placeholder="שם" value={form.customerName} onChange={(e) => set('customerName', e.target.value)} />
                  </div>
                  <div className="form-group">
                    <input type="tel" placeholder="טלפון" value={form.customerPhone} onChange={(e) => set('customerPhone', e.target.value)} />
                  </div>
                </div>
                <div className="form-group">
                  <div className="radio-group">
                    {['פרטי', 'עסקי'].map((t) => (
                      <label className="radio-label" key={t}>
                        <input
                          type="radio"
                          value={t}
                          checked={form.customerType === t}
                          onChange={(e) => set('customerType', e.target.value)}
                        />
                        {t}
                      </label>
                    ))}
                  </div>
                </div>
                <div className="form-group">
                  <input type="text" placeholder="כתובת" value={form.address} onChange={(e) => set('address', e.target.value)} />
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <input type="email" placeholder="דוא״ל" value={form.email} onChange={(e) => set('email', e.target.value)} />
                  </div>
                  <div className="form-group">
                    <input type="text" placeholder="עיר" value={form.city} onChange={(e) => set('city', e.target.value)} />
                  </div>
                  <div className="form-group">
                    <input type="text" placeholder="מיקוד" value={form.zip} onChange={(e) => set('zip', e.target.value)} />
                  </div>
                </div>
              </div>

              <div className="form-section">
                <h3 className="section-title card-title">
                  <IconCar /> פרטי רכב
                </h3>
                <div className="form-row">
                  <div className="form-group">
                    <input type="text" placeholder="מספר רישוי" value={form.licensePlate} onChange={(e) => set('licensePlate', e.target.value)} />
                  </div>
                  <div className="form-group">
                    <select value={form.manufacturer} onChange={(e) => set('manufacturer', e.target.value)}>
                      <option value="">יצרן</option>
                      {MAKERS.map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <input type="text" placeholder="דגם" value={form.model} onChange={(e) => set('model', e.target.value)} />
                  </div>
                  <div className="form-group">
                    <select value={form.year} onChange={(e) => set('year', e.target.value)}>
                      <option value="">שנת ייצור</option>
                      {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
                    </select>
                  </div>
                </div>
                <div className="form-group">
                  <input type="text" placeholder="ק״מ" value={form.km} onChange={(e) => set('km', e.target.value)} />
                </div>
              </div>

              <div className="form-section span-2">
                <h3 className="section-title">סיווג ושיוך</h3>
                <div className="form-row">
                  <div className="form-group">
                    <label>דחיפות</label>
                    <select value={form.priority} onChange={(e) => set('priority', e.target.value as Priority)}>
                      {Object.entries(PRIORITIES).map(([id, p]) => (
                        <option key={id} value={id}>{p.t}</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label>טכנאי אחראי</label>
                    <select value={form.technician} onChange={(e) => set('technician', e.target.value as TicketForm['technician'])}>
                      {Object.entries(TEAM).map(([id, m]) => (
                        <option key={id} value={id}>{m.n}</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label>תאריך יעד</label>
                    <input type="date" value={form.targetDate} onChange={(e) => set('targetDate', e.target.value)} />
                  </div>
                  <div className="form-group key-cell">
                    <label>מפתח רכב</label>
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={form.keyReceived}
                        onChange={(e) => set('keyReceived', e.target.checked)}
                      />
                      מפתח התקבל
                    </label>
                  </div>
                </div>
              </div>

              <div className="form-section span-2 works-wrap" id="sec-works">
                <WorksStep
                  works={works}
                  setWorks={setWorks}
                  catalog={catalog}
                  addToCatalog={(def) => setCatalog((prev) => [...prev, def])}
                  parts={partsCatalog}
                  addToParts={(part) => setPartsCatalog((prev) => [...prev, part])}
                />
              </div>

              </div>

              <div className="form-foot">
                <div className="total-card">
                  <span>סה״כ כולל מע״מ</span>
                  <b>{shekel(worksSummary(works).total)}</b>
                </div>
                <div className="foot-spacer" />
                <button type="button" className="btn ghost" onClick={closeForm}>
                  ביטול
                </button>
                <button type="submit" className="btn primary lg" disabled={works.length === 0}>
                  שמור כרטיס <span className="arrow">←</span>
                </button>
              </div>
            </form>
          ) : (
            <>
              {active === 'לוח בקרה' && (openTicket
                ? (() => {
                  const t = tickets.find((x) => x.k === openTicket);
                  return t ? (
                    <TicketPage
                      ticket={t}
                      setTickets={setTickets}
                      catalog={catalog}
                      addToCatalog={(def) => setCatalog((prev) => [...prev, def])}
                      parts={partsCatalog}
                      addToParts={(part) => setPartsCatalog((prev) => [...prev, part])}
                      onBack={() => setOpenTicket(null)}
                    />
                  ) : null;
                })()
                : (
                  <Board
                    tickets={tickets}
                    setTickets={setTickets}
                    onNewTicket={openForm}
                    onOpenTicket={setOpenTicket}
                  />
                )
              )}

              {active === 'חשבוניות' && (
                <InvoicesPage
                  tickets={tickets}
                  onOpenTicket={(k) => { setOpenTicket(k); setActive('לוח בקרה'); }}
                />
              )}

              {active === 'לקוחות' && <CustomersPage />}

              {active === 'פריטים' && <ItemsPage />}

              {active === 'דוחות' && <ReportsPage tickets={tickets} />}

            </>
          )}
        </section>
      </main>
    </div>
  );
}

export default App;
