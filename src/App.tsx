import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import { BoardPage } from './pages/Board';
import { CustomersPage } from './pages/Customers';
import { ItemsPage } from './pages/Items';
import { ReportsPage } from './pages/Reports';
import SetupNotice from './SetupNotice';
import TicketPage from './TicketPage';
import { WorksStep } from './features/works';
import { isConfigured } from './lib/supabase';
import { garageName, listCustomers, listVehicles, signOut, subscribeToTable, type Customer, type Vehicle } from '@garage/shared';
import { useTickets } from './lib/useTickets';
import { listWorkers, worksSummary, type TicketWork } from '@garage/shared';
import { InvoicesPage } from './pages/Invoices';
import { SuppliersPage } from './pages/Suppliers';
import { ExpensesPage } from './pages/Expenses';
import { ArchivePage } from './pages/Archive';
import { WorkersPage } from './pages/Workers';
import { IconBoard, IconBox, IconCar, IconCard, IconClock, IconCustomers, IconDoc, IconParts, IconPin, IconReports, IconWrench } from './icons';
import {
  EPICS, TYPES, isArchived, workerMap,
  type Priority, type Ticket, type Worker,
} from '@garage/shared';

interface TicketForm {
  customerSearch: string;
  customerName: string;
  customerPhone: string;
  idNumber: string;
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
  details: string;
  keyReceived: boolean;
  /** A garage_workers.code, or null for unassigned. Was one of four hardcoded
   *  codes; the garage's own workers are only known at runtime. */
  technician: string | null;
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
  details: '',
  keyReceived: false,
  // Not 'dk'. A blank form must not pre-assign work to a person, least of all
  // one this garage may not employ; the picker defaults to nobody.
  technician: null,
  targetDate: '',
  priority: 'med',
  epic: 'service',
  type: 'job',
  points: 3,
};

/* The sidebar and the routing table are the same list. A page that is not here
   has no way in, which is the point — one place to add a screen. */
const navItems = [
  { name: 'לוח בקרה', path: '/', Icon: IconBoard },
  { name: 'חשבוניות', path: '/invoices', Icon: IconDoc },
  { name: 'הוצאות', path: '/expenses', Icon: IconCard },
  { name: 'ספקים', path: '/suppliers', Icon: IconBox },
  { name: 'לקוחות', path: '/customers', Icon: IconCustomers },
  { name: 'עובדים', path: '/workers', Icon: IconWrench },
  { name: 'פריטים', path: '/items', Icon: IconParts },
  { name: 'דוחות', path: '/reports', Icon: IconReports },
  { name: 'ארכיון', path: '/archive', Icon: IconClock },
];

/** A ticket lives under the board, so the board stays lit while one is open. */
const isNavActive = (path: string, pathname: string) =>
  path === '/' ? pathname === '/' || pathname.startsWith('/tickets') : pathname.startsWith(path);

export const ticketPath = (key: string) => `/tickets/${encodeURIComponent(key)}`;

const YEARS = Array.from({ length: 22 }, (_, i) => 2026 - i);

const shekel = (n: number) => '₪' + n.toLocaleString('he-IL');

/* The ticket key comes from the URL now, not from state, so this needs its own
   component to call useParams. Kept at module scope — declared inside App it
   would be a new component type on every render, and the ticket page would
   remount (losing its scroll and any half-typed edit) on every keystroke. */
function TicketRoute({ tickets, ...rest }: {
  tickets: Ticket[];
} & Omit<React.ComponentProps<typeof TicketPage>, 'ticket'>) {
  const { key } = useParams();
  const ticket = tickets.find((t) => t.k === key);

  /* A key that matches nothing is a real case now that the URL is typeable and
     shareable — a deleted ticket, or a link from another garage. Say so rather
     than rendering an empty panel. No loading branch: App renders the routes
     only once the tickets have arrived. */
  if (!ticket) {
    return (
      <div className="db-error">
        הכרטיס {key} לא נמצא. <Link to="/">חזרה ללוח</Link>
      </div>
    );
  }
  return <TicketPage ticket={ticket} {...rest} />;
}

function App() {
  /* Which screen you are on is the URL, not state. That is what makes a ticket
     linkable, the browser's Back button work, and a refresh keep your place —
     all of which the old `active` string could not do. */
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const { tickets, setTickets, loading, error } = useTickets();   // Supabase-backed, live
  const [tab, setTab] = useState<1 | 2>(1);   // which half of the form is showing

  // Name the browser tab after the garage — several are often open at once.
  useEffect(() => { document.title = garageName(); }, []);
  const [form, setForm] = useState<TicketForm>(emptyForm);
  const [works, setWorks] = useState<TicketWork[]>([]);

  /* The garage's own staff, loaded with the catalog for the same reason: both
     used to be hardcoded constants shared by every garage. Empty is a valid
     state — a newly onboarded garage has entered nobody yet — so every consumer
     resolves a code through workerChip() and falls back to "unassigned" rather
     than indexing into this list. */
  const [workers, setWorkers] = useState<Worker[]>([]);

  // Retired workers stay in the map on purpose: a closed ticket must keep
  // showing who did the job, even after they leave.
  const workerChips = useMemo(() => workerMap(workers), [workers]);

  useEffect(() => {
    if (!isConfigured) return;
    let live = true;
    listWorkers()
      .then((team) => { if (live) setWorkers(team); })
      .catch(() => {});   // an empty picker beats a crash
    return () => { live = false; };
  }, []);

  /* The board's avatars and the table's מכונאי column read from this list, so an
     edit on the עובדים screen has to reach them. Subscribing rather than passing
     a callback down also covers the other device: two people are often on the
     board while a third fixes a name. */
  useEffect(() => {
    if (!isConfigured) return;
    return subscribeToTable('garage_workers', () => {
      listWorkers().then(setWorkers).catch(() => {});   // a stale chip beats a crash
    });
  }, []);


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
    navigate('/tickets/new');
  };

  const closeForm = () => { setVehicleChoices([]); navigate('/'); };

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
        ...(form.keyReceived ? ['מפתח התקבל'] : []),
        'חדש',
      ],
      works,
      phone: form.customerPhone,
      idNumber: form.idNumber,   // stored on the customer, not the ticket
      email: form.email,
      address: [form.address, form.city].filter(Boolean).join(', '),
      km: form.km,
      year: form.year,
      // in transit to the vehicles table, so the next ticket for this customer
      // can auto-fill the car; the ticket itself keeps the combined `car` above
      manufacturer: form.manufacturer,
      model: form.model,
      vehicleCode: form.vehicleCode,
      notes: form.details || undefined,   // "פרטים" from the create form → the ticket's notes
      createdAt: new Date().toLocaleDateString('he-IL'),
    };

    setTickets((prev) => [ticket, ...prev]);
    setWorks([]);
    setForm(emptyForm);
    closeForm();   // navigates to the board, so you land on the new ticket's card
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
      idNumber: c.id_number ?? '',
      email: c.email ?? '',
      address: c.address ?? '',
      city: c.city ?? '',
    }));
    setShowMatches(false);

    const owned = vehicles.filter((v) => v.customer_id === c.id);
    if (owned.length === 1) { fillVehicle(owned[0]); setVehicleChoices([]); }
    else setVehicleChoices(owned); // 0 -> nothing to pick; >1 -> let them choose
  };

  const pickVehicle = (v: Vehicle) => { fillVehicle(v); setVehicleChoices([]); };

  // Paid tickets that have aged past the cutoff leave the board for the archive.
  // Derived, so it recomputes as time passes — no stored flag to keep in sync.
  const activeTickets = tickets.filter((t) => !isArchived(t));
  const archivedTickets = tickets.filter((t) => isArchived(t));

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
                {/* This garage's own name, from onboarding. App renders only
                    once AuthGate has a membership, so it is always resolved. */}
                <div className="brand-name">{garageName()}</div>
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
            /* A real <a href>, not a button: middle-click and "open in new tab"
               now work, and the browser shows where each item goes. */
            <Link
              key={item.name}
              to={item.path}
              className={isNavActive(item.path, pathname) ? 'nav-item active' : 'nav-item'}
              title={item.name}
            >
              <span className="nav-icon"><item.Icon /></span>
              {expanded && <span className="nav-label">{item.name}</span>}
            </Link>
          ))}
        </nav>
        <div className="sidebar-footer">
          {expanded ? (
            <>
              <div className="status-badge">פתוח</div>
              <div className="footer-note">{activeTickets.length} כרטיסים פעילים</div>
              <button className="sign-out" onClick={() => void signOut()}>
                התנתקות
              </button>
            </>
          ) : (
            <>
              <div className="status-dot" title={`${activeTickets.length} כרטיסים פעילים`} />
              <button className="sign-out icon-only" onClick={() => void signOut()} title="התנתקות">
                ⏻
              </button>
            </>
          )}
        </div>
      </aside>

      {/* the board is the only screen that runs edge to edge */}
      <main className={`main-content${isConfigured && !loading && pathname === '/' ? ' board-full' : ''}`}>
        <section className="panel">
          {error && <div className="db-error">שגיאת Supabase: {error}</div>}

          {!isConfigured ? (
            <SetupNotice />
          ) : loading ? (
            <div className="db-loading">טוען נתונים מ‑Supabase…</div>
          ) : (
            <Routes>

            {/* ---------- new ticket ---------- */}
            <Route path="/tickets/new" element={
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
                    {/* km is a number only — strip anything non-digit as it's typed */}
                    <input type="text" inputMode="numeric" placeholder="קילומטר" value={form.km} onChange={(e) => set('km', e.target.value.replace(/\D/g, ''))} />
                  </div>
                  <div className="form-group">
                    <input type="text" placeholder="קוד" value={form.vehicleCode} onChange={(e) => set('vehicleCode', e.target.value)} />
                  </div>
                </div>
              </div>

              <div className="form-section span-2">
                <h3 className="section-title card-title">
                  <IconDoc /> פרטים
                </h3>
                <div className="form-group">
                  <textarea placeholder="פרטים" value={form.details} onChange={(e) => set('details', e.target.value)} />
                </div>
              </div>

              <div className="form-section span-2 works-wrap" id="sec-works">
                <WorksStep
                  works={works}
                  setWorks={setWorks}
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
            } />

            {/* ---------- the board, and one ticket ---------- */}
            <Route path="/" element={
              <BoardPage
                tickets={activeTickets}
                setTickets={setTickets}
                workers={workers}
                workerChips={workerChips}
                onNewTicket={openForm}
                onOpenTicket={(k) => navigate(ticketPath(k))}
              />
            } />

            <Route path="/tickets/:key" element={
              <TicketRoute
                tickets={tickets}
                setTickets={setTickets}
                workerChips={workerChips}
                onBack={() => navigate('/')}
              />
            } />

            {/* ---------- the rest of the sidebar ---------- */}
            <Route path="/invoices" element={
              <InvoicesPage onOpenTicket={(k) => navigate(ticketPath(k))} />
            } />

            <Route path="/expenses" element={<ExpensesPage />} />

            <Route path="/suppliers" element={<SuppliersPage />} />

            <Route path="/customers" element={<CustomersPage />} />

            <Route path="/workers" element={<WorkersPage />} />

            <Route path="/items" element={<ItemsPage />} />

            <Route path="/reports" element={<ReportsPage tickets={tickets} />} />

            <Route path="/archive" element={
              <ArchivePage
                tickets={archivedTickets}
                workerChips={workerChips}
                onOpenTicket={(k) => navigate(ticketPath(k))}
              />
            } />

            {/* A mistyped or stale URL lands on the board rather than a blank
                panel. replace, so Back does not bounce off the bad path. */}
            <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          )}
        </section>
      </main>
    </div>
  );
}

export default App;
