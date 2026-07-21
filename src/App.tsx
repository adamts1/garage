import { useEffect, useState } from 'react';
import Board from './Board';
import CustomersPage from './CustomersPage';
import ItemsPage from './ItemsPage';
import ReportsPage from './ReportsPage';
import SetupNotice from './SetupNotice';
import TicketPage from './TicketPage';
import WorksStep from './WorksStep';
import { isConfigured } from './lib/supabase';
import { listCustomers, listVehicles, subscribeToTable, type Customer, type Vehicle } from '@garage/shared';
import { useTickets } from './lib/useTickets';
import { PARTS_CATALOG, WORK_CATALOG, worksSummary, type PartDef, type TicketWork, type WorkDef } from '@garage/shared';
import InvoicesPage from './InvoicesPage';
import { IconBoard, IconCar, IconCustomers, IconDoc, IconParts, IconPin, IconReports } from './icons';
import {
  COLUMNS, EPICS, TEAM, TYPES,
  type Priority, type Ticket,
} from '@garage/shared';

interface TicketForm {
  customerSearch: string;
  customerName: string;
  customerPhone: string;
  idNumber: string;
  customerType: string;
  address: string;
  email: string;
  city: string;
  zip: string;
  licensePlate: string;
  vehicleCode: string;
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
  idNumber: '',
  customerType: 'פרטי',
  address: '',
  email: '',
  city: '',
  zip: '',
  licensePlate: '',
  vehicleCode: '',
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

  // known customers + their vehicles, for the "search + autofill" box on a new ticket
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [showMatches, setShowMatches] = useState(false);
  const [vehicleChoices, setVehicleChoices] = useState<Vehicle[]>([]);
  useEffect(() => {
    if (!isConfigured) return;
    const loadC = () => listCustomers().then(setCustomers).catch(() => {});
    const loadV = () => listVehicles().then(setVehicles).catch(() => {}); // no-op until the table exists
    loadC();
    loadV();
    const unsubC = subscribeToTable('customers', loadC);
    const unsubV = subscribeToTable('vehicles', loadV);
    return () => { unsubC(); unsubV(); };
  }, []);

  // sidebar: a narrow rail that expands on hover, unless pinned open
  const [pinned, setPinned] = useState(false);
  const [hovered, setHovered] = useState(false);
  const expanded = pinned || hovered;

  const openForm = () => {
    setForm(emptyForm);
    setWorks([]);
    setVehicleChoices([]);
    setShowForm(true);
  };

  const closeForm = () => { setShowForm(false); setVehicleChoices([]); };

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

  // customer search: match on name or phone (digits only), newest-known first
  const digits = (s: string) => (s || '').replace(/\D/g, '');
  const query = form.customerSearch.trim();
  const qDigits = digits(query);
  const customerMatches =
    query.length < 1
      ? []
      : customers
          .filter(
            (c) =>
              c.name.toLowerCase().includes(query.toLowerCase()) ||
              (qDigits.length >= 3 && digits(c.phone ?? '').includes(qDigits)),
          )
          .slice(0, 6);

  // fill the vehicle half of the form from a saved vehicle
  const fillVehicle = (v: Vehicle) =>
    setForm((prev) => ({
      ...prev,
      licensePlate: v.plate ?? '',
      manufacturer: v.manufacturer ?? '',
      model: v.model ?? '',
      year: v.year ?? '',
      km: v.km ?? '',
      vehicleCode: v.vehicle_code ?? '',
    }));

  // picking a match fills the customer half, and the vehicle too when it's unambiguous
  const pickCustomer = (c: Customer) => {
    setForm((prev) => ({
      ...prev,
      customerSearch: '',
      customerName: c.name,
      customerPhone: c.phone ?? '',
      email: c.email ?? '',
      address: c.address ?? '',
      city: c.city ?? '',
      customerType: c.kind || 'פרטי',
    }));
    setShowMatches(false);

    const owned = vehicles.filter((v) => v.customer_id === c.id);
    if (owned.length === 1) { fillVehicle(owned[0]); setVehicleChoices([]); }
    else setVehicleChoices(owned); // 0 -> nothing to pick; >1 -> let them choose
  };

  const pickVehicle = (v: Vehicle) => { fillVehicle(v); setVehicleChoices([]); };

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

      <main className={`main-content${isConfigured && !loading && !showForm && active === 'לוח בקרה' && !openTicket ? ' board-full' : ''}`}>
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
                   חזרה ללוח ←
                </button>
              </div>

              <div className="step1-grid" id="sec-details">
              <div className="form-section span-2 search-wrap">
                <input
                  type="text"
                  placeholder="חיפוש לקוח קיים לפי שם או טלפון"
                  className="search-input"
                  value={form.customerSearch}
                  onChange={(e) => { set('customerSearch', e.target.value); setShowMatches(true); }}
                  onFocus={() => setShowMatches(true)}
                  onBlur={() => setTimeout(() => setShowMatches(false), 150)}
                  autoComplete="off"
                />
                {showMatches && query.length >= 1 && (
                  <ul className="customer-suggest">
                    {customerMatches.length ? (
                      customerMatches.map((c) => (
                        <li key={c.id}>
                          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pickCustomer(c)}>
                            <span className="cs-name">{c.name}</span>
                            <span className="cs-meta">
                              {[c.phone, c.city].filter(Boolean).join(' · ')}
                              {c.kind === 'עסקי' && <span className="cs-tag">עסקי</span>}
                            </span>
                          </button>
                        </li>
                      ))
                    ) : (
                      <li className="cs-empty">לא נמצא לקוח תואם</li>
                    )}
                  </ul>
                )}
                {vehicleChoices.length > 0 && (
                  <div className="vehicle-picker">
                    <span className="vp-label">בחר רכב ללקוח:</span>
                    <div className="vp-list">
                      {vehicleChoices.map((v) => (
                        <button key={v.id} type="button" className="vp-chip" onClick={() => pickVehicle(v)}>
                          <b>{[v.manufacturer, v.model].filter(Boolean).join(' ') || v.plate}</b>
                          <span>{[v.plate, v.year, v.km && `${v.km} ק״מ`].filter(Boolean).join(' · ')}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
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
                  <div className="form-group">
                    <input type="text" inputMode="numeric" placeholder="ת״ז" value={form.idNumber} onChange={(e) => set('idNumber', e.target.value)} />
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
                    <input type="text" placeholder="יצרן" value={form.manufacturer} onChange={(e) => set('manufacturer', e.target.value)} />
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
                <div className="form-row">
                  <div className="form-group">
                    <input type="text" inputMode="numeric" placeholder="קילומטר" value={form.km} onChange={(e) => set('km', e.target.value)} />
                  </div>
                  <div className="form-group">
                    <input type="text" placeholder="קוד" value={form.vehicleCode} onChange={(e) => set('vehicleCode', e.target.value)} />
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
                <button
                  type="submit"
                  className="btn primary lg"
                  disabled={!form.customerName.trim() && !form.licensePlate.trim() && works.length === 0}
                  title={
                    !form.customerName.trim() && !form.licensePlate.trim() && works.length === 0
                      ? 'הזן שם לקוח, מספר רישוי או עבודה אחת כדי לשמור'
                      : undefined
                  }
                >
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
