/* The ticket shape and the catalog, shared with the web app.
   Kept identical to ../../src/board-data.ts + ../../src/catalog.ts on purpose:
   db.ts maps between these types and the Supabase rows, exactly as the web app does.
   If you change a type here, change it there too (and in supabase/schema.sql). */

export type Status = 'todo' | 'appr' | 'prog' | 'parts' | 'done';
export type Priority = 'urgent' | 'high' | 'med' | 'low';

export interface PartRow {
  sku: string;
  name: string;
  qty: number;
  price: number;
}

/** A work as attached to a ticket - a copy of the catalog definition the user can edit. */
export interface TicketWork {
  uid: string;            // unique per ticket (the same work can be added twice)
  code: string;
  name: string;
  labor: number;
  items: PartRow[];
  custom?: boolean;       // true when it isn't in the catalog
}

export interface WorkDef {
  id: string;
  code: string;
  name: string;
  labor: number;
  hours: number;
  items: PartRow[];
}

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
  done: number;           // how many subtasks are checked - a COUNT, not a per-item flag
  subtasks: string[];
  due: string;
  flags: string[];
  blocked?: string;
  works?: TicketWork[];

  phone?: string;
  email?: string;
  address?: string;
  km?: string;
  year?: string;
  createdAt?: string;
  notes?: string;

  paid?: boolean;
  payMethod?: string;
  doc?: string;
  reference?: string;
}

export const COLUMNS: { id: Status; title: string; dot: string }[] = [
  { id: 'todo', title: 'ממתין לטיפול', dot: '#748cab' },
  { id: 'appr', title: 'ממתין לאישור', dot: '#1d2d44' },
  { id: 'prog', title: 'בעבודה', dot: '#b58a3c' },
  { id: 'parts', title: 'חסום - חלקים', dot: '#a5544b' },
  { id: 'done', title: 'מוכן לאיסוף', dot: '#4f7a5b' },
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

export const VAT = 0.18;

export const WORK_CATALOG: WorkDef[] = [
  {
    id: 'oil', code: 'OIL-01', name: 'טיפול שמן מלא', labor: 120, hours: 1,
    items: [
      { sku: 'OIL-530', name: 'שמן מנוע 5W-30 (ליטר)', qty: 5, price: 45 },
      { sku: 'FLT-OIL', name: 'פילטר שמן', qty: 1, price: 65 },
      { sku: 'FLT-AIR', name: 'פילטר אוויר', qty: 1, price: 90 },
    ],
  },
  {
    id: 'brake-front', code: 'BRK-F', name: 'בלמים קדמיים', labor: 250, hours: 2,
    items: [
      { sku: 'BRK-F22', name: 'רפידות בלם קדמי', qty: 1, price: 240 },
      { sku: 'DSC-F10', name: 'דיסקיות בלם קדמי', qty: 2, price: 180 },
      { sku: 'FLD-BRK', name: 'נוזל בלמים DOT4', qty: 1, price: 35 },
    ],
  },
  {
    id: 'brake-rear', code: 'BRK-R', name: 'בלמים אחוריים', labor: 220, hours: 2,
    items: [
      { sku: 'BRK-R18', name: 'רפידות בלם אחורי', qty: 1, price: 190 },
      { sku: 'DSC-R08', name: 'דיסקיות בלם אחורי', qty: 2, price: 150 },
    ],
  },
  {
    id: 'battery', code: 'BAT-01', name: 'החלפת מצבר', labor: 60, hours: 0.5,
    items: [{ sku: 'BAT-70A', name: 'מצבר 70 אמפר', qty: 1, price: 520 }],
  },
  {
    id: 'ac', code: 'AC-01', name: 'טיפול מזגן', labor: 180, hours: 1.5,
    items: [
      { sku: 'GAS-134', name: 'גז מזגן R134', qty: 1, price: 220 },
      { sku: 'FLT-CAB', name: 'מסנן אבקנים', qty: 1, price: 75 },
    ],
  },
  {
    id: 'suspension', code: 'SUS-01', name: 'החלפת בולמים אחוריים', labor: 320, hours: 3,
    items: [
      { sku: 'SHK-R09', name: 'בולם זעזועים אחורי', qty: 2, price: 360 },
      { sku: 'MNT-R01', name: 'תותב בולם', qty: 2, price: 45 },
    ],
  },
  {
    id: 'timing', code: 'TIM-01', name: 'החלפת רצועת טיימינג', labor: 650, hours: 5,
    items: [
      { sku: 'TIM-KIT', name: 'ערכת רצועת טיימינג', qty: 1, price: 890 },
      { sku: 'PMP-WTR', name: 'משאבת מים', qty: 1, price: 320 },
    ],
  },
  {
    id: 'clutch', code: 'CLT-01', name: 'החלפת מצמד מלא', labor: 900, hours: 6,
    items: [
      { sku: 'CLT-FRD', name: 'ערכת מצמד מלאה', qty: 1, price: 1650 },
      { sku: 'BRG-CLT', name: 'מיסב מצמד', qty: 1, price: 180 },
    ],
  },
  { id: 'diag', code: 'DIA-01', name: 'אבחון מחשב (OBD)', labor: 150, hours: 1, items: [] },
  {
    id: 'test', code: 'TST-01', name: 'בדיקת טסט שנתי', labor: 200, hours: 1,
    items: [{ sku: 'BLB-H7', name: 'נורת הלוגן H7', qty: 2, price: 25 }],
  },
];

export type PartDef = Omit<PartRow, 'qty'>;

export const PARTS_CATALOG: PartDef[] = [
  { sku: 'OIL-530', name: 'שמן מנוע 5W-30 (ליטר)', price: 45 },
  { sku: 'FLT-OIL', name: 'פילטר שמן', price: 65 },
  { sku: 'FLT-AIR', name: 'פילטר אוויר', price: 90 },
  { sku: 'FLT-CAB', name: 'מסנן אבקנים', price: 75 },
  { sku: 'BRK-F22', name: 'רפידות בלם קדמי', price: 240 },
  { sku: 'DSC-F10', name: 'דיסקיות בלם קדמי', price: 180 },
  { sku: 'BAT-70A', name: 'מצבר 70 אמפר', price: 520 },
  { sku: 'GAS-134', name: 'גז מזגן R134', price: 220 },
  { sku: 'SHK-R09', name: 'בולם זעזועים אחורי', price: 360 },
  { sku: 'BLB-H7', name: 'נורת הלוגן H7', price: 25 },
  { sku: 'WPR-BLD', name: 'מגבי שמשה (זוג)', price: 80 },
];

export const partsTotal = (w: TicketWork) => w.items.reduce((s, i) => s + i.qty * i.price, 0);

export const workTotal = (w: TicketWork) => w.labor + partsTotal(w);

export const worksSummary = (works: TicketWork[]) => {
  const parts = works.reduce((s, w) => s + partsTotal(w), 0);
  const labor = works.reduce((s, w) => s + w.labor, 0);
  const net = parts + labor;
  const vat = Math.round(net * VAT);
  return { parts, labor, net, vat, total: net + vat };
};

export const fromCatalog = (def: WorkDef, uid: string): TicketWork => ({
  uid,
  code: def.code,
  name: def.name,
  labor: def.labor,
  items: def.items.map((i) => ({ ...i })),   // copy so edits don't mutate the catalog
  custom: false,
});
