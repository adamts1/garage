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

export const INITIAL_TICKETS: Ticket[] = [
  {
    k: 'GAR-142', st: 'prog', type: 'job', epic: 'brakes', prio: 'urgent', pts: 5, who: 'dk', job: 'W-1042',
    title: 'רעש חריקה בבלימה - החלפת רפידות ודיסקיות קדמיות',
    plate: '12-345-67', car: 'טויוטה קורולה', customer: 'יוסי לוי', amount: 2340,
    done: 3, subtasks: ['פירוק גלגלים קדמיים', 'מדידת עובי דיסקית', 'החלפת רפידות', 'הרכבה ומומנט', 'נסיעת מבחן'],
    due: 'היום 16:00', flags: ['VIP', 'ממתין בבית'],
  },
  {
    k: 'GAR-143', st: 'prog', type: 'job', epic: 'service', prio: 'med', pts: 3, who: 'dk', job: 'W-1042',
    title: 'טיפול 100,000 ק״מ - שמן, פילטרים ונוזלים',
    plate: '12-345-67', car: 'טויוטה קורולה', customer: 'יוסי לוי', amount: 640,
    done: 3, subtasks: ['החלפת שמן מנוע', 'פילטר שמן ואוויר', 'בדיקת נוזלים'],
    due: 'היום 16:00', flags: [],
  },
  {
    k: 'GAR-138', st: 'appr', type: 'quote', epic: 'engine', prio: 'urgent', pts: 8, who: 'il', job: 'W-1043',
    title: 'החלפת מצמד מלא - פורד טרנזיט',
    plate: '45-901-23', car: 'פורד טרנזיט', customer: 'חברת דלתא בע״מ', amount: 2890,
    done: 0, subtasks: ['פירוק תיבת הילוכים', 'החלפת ערכת מצמד', 'הרכבה', 'נסיעת מבחן'],
    due: 'עבר יומיים', flags: ['VIP', 'ממתין יומיים'],
  },
  {
    k: 'GAR-139', st: 'appr', type: 'quote', epic: 'ac', prio: 'high', pts: 2, who: 'il', job: 'W-1043',
    title: 'מזגן לא מקרר - גז R134 ובדיקת נזילות',
    plate: '45-901-23', car: 'פורד טרנזיט', customer: 'חברת דלתא בע״מ', amount: 420,
    done: 0, subtasks: ['בדיקת לחצים', 'מילוי גז'],
    due: 'עבר יומיים', flags: ['VIP'],
  },
  {
    k: 'GAR-145', st: 'appr', type: 'quote', epic: 'service', prio: 'med', pts: 3, who: 'dk', job: 'W-1044',
    title: 'רצועת טיימינג + ניקוי מערכת דלק',
    plate: '63-820-11', car: 'מאזדה CX-5', customer: 'א. פרידמן', amount: 2400,
    done: 0, subtasks: ['הצעת מחיר ללקוח', 'החלפת רצועה', 'ניקוי מזרקים'],
    due: 'איסוף 17:00', flags: ['איסוף היום'],
  },
  {
    k: 'GAR-131', st: 'parts', type: 'part', epic: 'susp', prio: 'high', pts: 5, who: 'il', job: 'W-1039',
    title: 'החלפת בולמים אחוריים - ממתין למשלוח מהספק',
    plate: '30-555-90', car: 'קיה ספורטג׳', customer: 'מוחמד עלי', amount: 1890,
    done: 2, subtasks: ['אבחון בולמים', 'הזמנת חלקים', 'פירוק', 'הרכבה', 'יישור'],
    due: 'צפי 14/07', flags: [], blocked: 'בולם זעזועים אחורי - הזמנה #4471 בדרך',
  },
  {
    k: 'GAR-146', st: 'parts', type: 'part', epic: 'engine', prio: 'urgent', pts: 8, who: 'il', job: 'W-1043',
    title: 'מצמד מלא פורד - אזל מהמלאי',
    plate: '45-901-23', car: 'פורד טרנזיט', customer: 'חברת דלתא בע״מ', amount: 940,
    done: 0, subtasks: ['בירור מול יבואן', 'הזמנה', 'קליטה למלאי'],
    due: 'טרם הוזמן', flags: ['חוסם עבודה'], blocked: 'מלאי 0 - נדרשת הזמנה מיבואן ישיר',
  },
  {
    k: 'GAR-140', st: 'todo', type: 'diag', epic: 'elec', prio: 'high', pts: 2, who: 'dk', job: 'W-1041',
    title: 'נורית מנוע דולקת - קריאת תקלות במחשב',
    plate: '88-221-04', car: 'יונדאי i20', customer: 'שרה כהן', amount: 0,
    done: 1, subtasks: ['חיבור סורק OBD', 'פענוח קודי תקלה', 'הצעת המשך טיפול'],
    due: 'היום', flags: ['חדש'],
  },
  {
    k: 'GAR-147', st: 'todo', type: 'test', epic: 'body', prio: 'med', pts: 1, who: 'ns', job: 'W-1047',
    title: 'בדיקת טסט שנתי - הכנה לרישוי',
    plate: '45-901-23', car: 'פורד טרנזיט', customer: 'חברת דלתא בע״מ', amount: 350,
    done: 0, subtasks: ['בדיקת אורות', 'בדיקת בלמים', 'בדיקת פליטה', 'תיאום מכון רישוי'],
    due: '20/08', flags: [],
  },
  {
    k: 'GAR-148', st: 'prog', type: 'job', epic: 'service', prio: 'med', pts: 2, who: 'dk', job: 'W-1040',
    title: 'נסיעת מבחן ובדיקה סופית אחרי טיפול',
    plate: '61-430-18', car: 'מאזדה 3', customer: 'רונית ברק', amount: 0,
    done: 2, subtasks: ['נסיעת מבחן', 'בדיקת דליפות', 'ניקוי הרכב'],
    due: 'היום', flags: [],
  },
  {
    k: 'GAR-136', st: 'done', type: 'job', epic: 'service', prio: 'low', pts: 3, who: 'dk', job: 'W-1038',
    title: 'החלפת שמן + פילטרים - הושלם',
    plate: '61-430-18', car: 'מאזדה 3', customer: 'רונית ברק', amount: 780,
    done: 3, subtasks: ['החלפת שמן', 'החלפת פילטרים', 'איפוס מחוון טיפול'],
    due: '-', flags: ['שולם'],
  },
  {
    k: 'GAR-149', st: 'todo', type: 'job', epic: 'brakes', prio: 'med', pts: 3, who: 'il', job: 'W-1045',
    title: 'בלמים אחוריים חורקים - סקודה אוקטביה',
    plate: '22-114-88', car: 'סקודה אוקטביה', customer: 'נועם ברק', amount: 0,
    done: 0, subtasks: ['אבחון רעש', 'הצעת מחיר', 'ביצוע'],
    due: 'מחר', flags: ['חדש'],
  },
  {
    k: 'GAR-150', st: 'todo', type: 'diag', epic: 'elec', prio: 'low', pts: 2, who: 'ns', job: 'W-1046',
    title: 'מצבר מתרוקן - בדיקת מערכת טעינה',
    plate: '51-778-20', car: 'פיאט 500', customer: 'ליאת דגן', amount: 0,
    done: 0, subtasks: ['בדיקת אלטרנטור', 'בדיקת מצבר'],
    due: 'מחר', flags: [],
  },
];
