import type { TicketWork } from './catalog';

/* Four columns, which is what a garage actually tracks: the car is here, the
   customer has to approve, the car is ready, the money is in.

   It was six — ממתין לטיפול / ממתין לאישור / בעבודה / חסום-חלקים / מוכן לאיסוף /
   שולם. "בעבודה" and "חסום - חלקים" are gone: both mean the car is in the shop
   and not ready, which is what כניסה says, and a board nobody drags cards
   across is a board that lies. A blocker is still recordable — `blocked` is a
   note on the ticket, no longer a column. */
export type Status = 'todo' | 'appr' | 'done' | 'paid';
export type Priority = 'urgent' | 'high' | 'med' | 'low';
export type GroupBy = 'none' | 'who' | 'prio' | 'epic';

export interface Ticket {
  k: string;
  st: Status;
  type: keyof typeof TYPES;
  epic: keyof typeof EPICS;
  prio: Priority;
  pts: number;
  /** A garage_workers.code, or null when nobody is assigned.
   *
   *  Was `keyof typeof TEAM` — one of four codes hardcoded in this file. Now a
   *  free string, because the set of valid codes belongs to the garage and is
   *  only knowable at runtime. Resolve it through the workers map from
   *  fetchWorkers(); a code with no row means a worker was deleted, so render
   *  it as unassigned rather than indexing blindly. */
  who: string | null;
  job: string;
  title: string;
  plate: string;
  car: string;
  customer: string;
  amount: number;
  done: number;
  subtasks: string[];
  due: string;
  flags: string[];
  blocked?: string;
  works?: TicketWork[];   // works + their parts, from the create form

  /* captured on creation, shown on the ticket page */
  phone?: string;
  email?: string;
  address?: string;

  /** ת״ז, in transit only.
   *
   *  Unlike phone / email / address above, this is NOT a column on tickets.
   *  It rides along so findOrCreateCustomer can put it on the customer record,
   *  where a national ID belongs, and ticketToRow deliberately ignores it.
   *  Reading a ticket back from the database never populates this field —
   *  read it from the customer. See docs/PRODUCTION.md §3.10. */
  idNumber?: string;

  /** The customer this ticket was explicitly opened against, when the advisor
   *  picked an existing one out of the search box rather than typing a name.
   *
   *  In transit only, like idNumber: `tickets.customer_id` is a real column,
   *  but it is filled by create_ticket's own resolution, never mapped by
   *  ticketToRow, and reading a ticket back never repopulates this field.
   *
   *  It exists because the search box knows something the ת״ז-then-phone
   *  resolution cannot recover: *which* record the human meant. A customer
   *  saved years ago with no phone would otherwise be duplicated the moment
   *  somebody picked them and filled the phone in. The server still checks the
   *  id belongs to the caller's garage before honouring it. */
  customerId?: string | null;
  km?: string;
  year?: string;

  /** Vehicle details, in transit only — like idNumber, these are NOT columns on
   *  tickets. They ride along so create_ticket can promote the car into the
   *  vehicles table (keyed on customer + plate), where the next ticket's
   *  auto-fill reads them. The ticket keeps its own denormalised `car` string;
   *  reading a ticket back never repopulates these. See docs/PRODUCTION.md §3.10. */
  manufacturer?: string;
  model?: string;
  vehicleCode?: string;
  createdAt?: string;
  /** raw ISO timestamp - createdAt is already localised, so it can't be sorted or aged */
  createdAtISO?: string;
  notes?: string;

  /* set when the ticket is closed and billed */
  paid?: boolean;
  payMethod?: string;
  doc?: string;
  reference?: string;
}

/** Two days after a ticket is settled it drops off the board into the archive.
 *  "Settled" means paid (status 'paid'); the clock runs from the due date, or
 *  from the creation date when the ticket has no due date. This is derived, not
 *  stored — recomputed on every render, so a paid ticket archives itself once it
 *  ages out, and reappears on the board the moment it's dragged out of 'שולם'. */
export const ARCHIVE_AFTER_DAYS = 2;

// due is a 'DD/MM/YYYY' string (or '-' when unset); parse it to a Date at midnight.
const parseDueDate = (s: string | undefined): Date | null => {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec((s ?? '').trim());
  if (!m) return null;
  const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  return Number.isNaN(d.getTime()) ? null : d;
};

export const isArchived = (t: Ticket, now: Date = new Date()): boolean => {
  if (t.st !== 'paid') return false;
  // due date first; fall back to the raw ISO creation timestamp when there's none
  const base = parseDueDate(t.due) ?? (t.createdAtISO ? new Date(t.createdAtISO) : null);
  if (!base || Number.isNaN(base.getTime())) return false;
  const cutoff = new Date(base);
  cutoff.setDate(cutoff.getDate() + ARCHIVE_AFTER_DAYS);
  return now.getTime() >= cutoff.getTime();
};

/* The board, left to right. `wip` caps a column and is optional — no column
   sets one now that "בעבודה" is gone, but the board still honours it, so a
   garage that wants a ceiling on open jobs has somewhere to put it. */
export const COLUMNS: { id: Status; title: string; dot: string; wip?: number }[] = [
  { id: 'todo', title: 'כניסה', dot: '#748cab' },
  { id: 'appr', title: 'ממתין לאישור', dot: '#1d2d44' },
  { id: 'done', title: 'מוכן', dot: '#4f7a5b' },   // מוכן, טרם שולם
  { id: 'paid', title: 'שולם', dot: '#2f6b4a' },
];

export const EPICS = {
  brakes: { t: 'בלמים', bg: '#f3e6e4', c: '#8f453d' },
  engine: { t: 'מנוע', bg: '#e8ecf1', c: '#1d2d44' },
  service: { t: 'טיפולים', bg: '#e6ede6', c: '#3f6249' },
  ac: { t: 'מיזוג', bg: '#e4edf0', c: '#3c6675' },
  susp: { t: 'מתלים', bg: '#eae7f0', c: '#4c4670' },
  elec: { t: 'חשמל', bg: '#f0ebd8', c: '#8a6b28' },
  body: { t: 'פחחות', bg: '#eceadf', c: '#5a5a4a' },
} as const;

export const PRIORITIES: Record<Priority, { t: string; c: string }> = {
  urgent: { t: 'דחוף', c: '#a5544b' },
  high: { t: 'גבוה', c: '#b58a3c' },
  med: { t: 'רגיל', c: '#748cab' },
  low: { t: 'נמוך', c: '#c9c4b4' },
};

export const TYPES = {
  job: { i: '🔧', t: 'עבודה' },
  diag: { i: '🔍', t: 'אבחון' },
  part: { i: '📦', t: 'חלק' },
  quote: { i: '🧾', t: 'הצעת מחיר' },
  test: { i: '📋', t: 'טסט' },
} as const;

/* ---------- the team ----------

   TEAM used to live here as four hardcoded people — דני כהן, עידו לוי,
   נועה שמש, אבי מזרחי — which every garage saw and none employed. Workers are
   now rows in garage_workers, per garage, so this file can only describe their
   shape. See 20260730000000_baseline.sql.

   The display keys stay short (n / ini / bg) because that is what the board,
   the ticket page and the mobile editor already read. */
export interface Worker {
  id: string;
  /** Stored on tickets.assignee. Unique within the garage, not globally. */
  code: string;
  name: string;
  initials: string;
  color: string;
  position: number;
  /** false means retired: hidden from pickers, still resolves on old tickets —
   *  and, since a worker is a person who signs in, no longer able to reach the
   *  garage at all. current_garage_id() requires this. */
  active: boolean;
  /** The login behind this worker. NULL for a mechanic with no account and for
   *  the rows that predate the two tables being joined up. */
  userId: string | null;
}

export interface WorkerChip {
  n: string;
  ini: string;
  bg: string;
}

/** Code → chip, for rendering a ticket's assignee. Includes retired workers, so
 *  a closed ticket keeps showing who did the job. */
export type WorkerMap = Record<string, WorkerChip>;

export const workerMap = (workers: Worker[]): WorkerMap =>
  Object.fromEntries(
    workers.map((w) => [w.code, { n: w.name, ini: w.initials, bg: w.color }]),
  );

/** What an assignment picker should offer: active workers only, in the garage's
 *  own order. A retired worker must not be assignable to new work. */
export const assignableWorkers = (workers: Worker[]): Worker[] =>
  workers.filter((w) => w.active).sort((a, b) => a.position - b.position);

/** Shown wherever a ticket has no assignee, or an assignee whose worker row is
 *  gone. Both are genuinely "nobody", and saying so beats an empty chip. */
export const UNASSIGNED: WorkerChip = { n: 'לא הוקצה', ini: '—', bg: '#8d99ae' };

export const workerChip = (workers: WorkerMap, code: string | null): WorkerChip =>
  (code ? workers[code] : undefined) ?? UNASSIGNED;
