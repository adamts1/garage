import type { TicketWork } from './catalog';

export type Status = 'todo' | 'appr' | 'prog' | 'parts' | 'done' | 'paid';
export type Priority = 'urgent' | 'high' | 'med' | 'low';
export type GroupBy = 'none' | 'who' | 'prio' | 'epic';

export interface Ticket {
  k: string;
  st: Status;
  type: keyof typeof TYPES;
  epic: keyof typeof EPICS;
  prio: Priority;
  pts: number;
  who: keyof typeof TEAM;
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
  km?: string;
  year?: string;
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

export const COLUMNS: { id: Status; title: string; dot: string; wip?: number }[] = [
  { id: 'todo', title: 'ממתין לטיפול', dot: '#748cab' },
  { id: 'appr', title: 'ממתין לאישור', dot: '#1d2d44' },
  { id: 'prog', title: 'בעבודה', dot: '#b58a3c', wip: 4 },
  { id: 'parts', title: 'חסום - חלקים', dot: '#a5544b' },
  { id: 'done', title: 'מוכן לאיסוף', dot: '#4f7a5b' },   // מוכן, טרם שולם
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

export const TEAM = {
  dk: { n: 'דני כהן', ini: 'דכ', bg: '#1d2d44' },
  il: { n: 'עידו לוי', ini: 'על', bg: '#3e5c76' },
  ns: { n: 'נועה שמש', ini: 'נש', bg: '#4f7a5b' },
  am: { n: 'אבי מזרחי', ini: 'אמ', bg: '#748cab' },
} as const;
