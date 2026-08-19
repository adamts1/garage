/* The demo board — parts, catalogue, customers, cars and fourteen tickets.
 *
 * Data only: no client, no inserts, no garage id. Three scripts write it, and
 * they write it differently, so the shared half stops here:
 *
 *   seed-demo.mjs      wipes a garage and rebuilds it. Local and staging only.
 *   seed-catalog.mjs   the works and parts, additively.
 *   seed-board.mjs     the customers, cars and tickets, additively.
 *
 * The last two are additive, which is what makes them safe to point at
 * production; the first is not, and refuses it.
 *
 * Prices are pre-VAT throughout, as every price in this system is.
 */

/* ---------------- catalogue ----------------

   Parts first: a work definition's parts are stored by sku and name, and the
   price a ticket copies comes from here. */

export const PARTS = [
  { sku: 'OIL-5W30', name: 'שמן מנוע 5W30 (ליטר)', price: 42, stock: 60 },
  { sku: 'FLT-OIL', name: 'מסנן שמן', price: 65, stock: 24 },
  { sku: 'FLT-AIR', name: 'מסנן אוויר', price: 90, stock: 18 },
  { sku: 'FLT-CAB', name: 'מסנן מזגן', price: 110, stock: 12 },
  { sku: 'BRK-PAD-F', name: 'רפידות בלם קדמיות (ערכה)', price: 320, stock: 8 },
  { sku: 'BRK-DSC-F', name: 'דיסק בלם קדמי (יחידה)', price: 280, stock: 6 },
  { sku: 'BELT-TIM', name: 'ערכת רצועת תזמון', price: 780, stock: 3 },
  { sku: 'SHK-R', name: 'בולם זעזועים אחורי (יחידה)', price: 420, stock: 4 },
  { sku: 'AC-GAS', name: 'גז מזגן R134a', price: 90, stock: 15 },
  { sku: 'BAT-70', name: 'מצבר 70 אמפר', price: 640, stock: 5 },
  { sku: 'WPR', name: 'ערכת מגבים', price: 85, stock: 20 },
  { sku: 'SPK', name: 'מצת (יחידה)', price: 45, stock: 32 },
];
/* A work definition and the parts it normally consumes. `labor` is pre-VAT, as
   every price in this system is — the provider adds the VAT. */
export const CATALOG = [
  { code: 'SRV-10', name: 'טיפול 10,000 ק״מ', labor: 180, hours: 1,
    parts: [['OIL-5W30', 4], ['FLT-OIL', 1]] },
  { code: 'SRV-30', name: 'טיפול 30,000 ק״מ', labor: 320, hours: 2,
    parts: [['OIL-5W30', 5], ['FLT-OIL', 1], ['FLT-AIR', 1]] },
  { code: 'BRK-PF', name: 'החלפת רפידות בלם קדמיות', labor: 220, hours: 1.5,
    parts: [['BRK-PAD-F', 1]] },
  { code: 'BRK-DF', name: 'החלפת דיסקים קדמיים', labor: 280, hours: 2,
    parts: [['BRK-DSC-F', 2]] },
  { code: 'ENG-TB', name: 'החלפת רצועת תזמון', labor: 950, hours: 4,
    parts: [['BELT-TIM', 1]] },
  { code: 'SUS-RS', name: 'החלפת בולמים אחוריים', labor: 400, hours: 2.5,
    parts: [['SHK-R', 2]] },
  { code: 'AC-GAS', name: 'מילוי גז מזגן', labor: 150, hours: 0.5,
    parts: [['AC-GAS', 1]] },
  { code: 'AC-SRV', name: 'טיפול מערכת מיזוג', labor: 380, hours: 2,
    parts: [['FLT-CAB', 1], ['AC-GAS', 1]] },
  { code: 'ELE-CK', name: 'בדיקת מערכת חשמל', labor: 200, hours: 1, parts: [] },
  { code: 'ELE-BT', name: 'החלפת מצבר', labor: 80, hours: 0.5, parts: [['BAT-70', 1]] },
  { code: 'DIA-CP', name: 'אבחון מחשב', labor: 120, hours: 0.5, parts: [] },
  { code: 'WHL-AL', name: 'איזון וכיוון פרונט', labor: 180, hours: 1, parts: [] },
];

export const partBySku = Object.fromEntries(PARTS.map((p) => [p.sku, p]));

/* ---------------- customers and their cars ---------------- */

export const CUSTOMERS = [
  { ref: 'dana', name: 'דנה כהן', phone: '0521234567', kind: 'private', city: 'חיפה', address: 'הרצל 4', email: 'dana.cohen@gmail.com',
    cars: [{ plate: '78412030', manufacturer: 'טויוטה', model: 'קורולה', year: '2019', km: '96500', vehicle_code: '1042' }] },
  { ref: 'moshe', name: 'משה אברהמי', phone: '0543219876', kind: 'private', city: 'קריית ים', address: 'ההגנה 12',
    cars: [{ plate: '35928140', manufacturer: 'מאזדה', model: '3', year: '2017', km: '142300', vehicle_code: '2318' }] },
  { ref: 'bendavid', name: 'הובלות בן־דוד בע״מ', phone: '0509998877', kind: 'business', id_number: '514872236', city: 'חיפה', address: 'המפרץ 3', email: 'office@bendavid-moving.co.il',
    cars: [
      { plate: '91742500', manufacturer: 'פורד', model: 'טרנזיט', year: '2021', km: '88400', vehicle_code: '7761' },
      { plate: '62381900', manufacturer: 'פיאט', model: 'דוקאטו', year: '2020', km: '121000', vehicle_code: '7802' },
    ] },
  { ref: 'ronit', name: 'רונית שפירא', phone: '0526543210', kind: 'private', city: 'נשר', address: 'השופטים 7',
    cars: [{ plate: '88305720', manufacturer: 'יונדאי', model: 'i20', year: '2022', km: '41200', vehicle_code: '3390' }] },
  { ref: 'omer', name: 'עומר בן חיים', phone: '0587776655', kind: 'private', city: 'קריית ביאליק', address: 'ז׳בוטינסקי 21',
    cars: [{ plate: '20657430', manufacturer: 'קיה', model: 'ספורטאז׳', year: '2018', km: '118700', vehicle_code: '5514' }] },
  { ref: 'eli', name: 'אלי מזרחי', phone: '0541112233', kind: 'private', city: 'טירת כרמל', address: 'הגליל 9',
    cars: [{ plate: '57190380', manufacturer: 'סקודה', model: 'אוקטביה', year: '2016', km: '187400', vehicle_code: '6127' }] },
  { ref: 'ester', name: 'אסתר גולן', phone: '0503334455', kind: 'private', city: 'חיפה', address: 'מוריה 88',
    cars: [{ plate: '14839260', manufacturer: 'סוזוקי', model: 'ויטרה', year: '2020', km: '63800', vehicle_code: '4408' }] },
];

/* ---------------- tickets ----------------

   Numbering starts at 101 deliberately: a garage on its hundredth job reads
   better in a demo than one on its third, and in seed-demo it also has to clear
   every ticket_key an existing invoice refers to. Whoever writes these owns the
   garage_counters row afterwards — create_ticket takes the next key from there,
   so leaving it behind hands the next real ticket a key one of these holds.

   `who` names a worker code from the seed-demo demo staff. A garage with real
   workers in it has none of those codes, and tickets.assignee is a foreign key
   to garage_workers.code — so seed-board maps these onto whatever staff
   the garage actually has rather than sending them as they are. */

export const VAT = 0.18;
export const iso = (d) => new Date(`${d}T00:00:00+03:00`).toISOString();
/** dd/mm/yyyy, the format the intake form writes and the ticket page prints. */
export const due = (d) => d.split('-').reverse().join('/');

/** Exactly what the app stores: gross, rounded to the shekel. See storedAmount. */
export const amountOf = (works) => Math.round(
  works.reduce((s, w) => s + w.labor + w.items.reduce((p, i) => p + i.qty * i.price, 0), 0) * (1 + VAT));

/** A catalogue entry, priced as a ticket's own copy of it. */
export const work = (code, uid) => {
  const def = CATALOG.find((c) => c.code === code);
  return {
    uid, code: def.code, name: def.name, labor: def.labor, custom: false,
    items: def.parts.map(([sku, qty]) => ({ sku, name: partBySku[sku].name, qty, price: partBySku[sku].price })),
  };
};

/* `pay_method` holds a code, never the word a screen displays — the whole point
   of 20260810000000_payment_methods_are_codes.sql. Seeding the Hebrew would
   hand a fresh demo garage exactly the legacy values that migration exists to
   remove, and the apps would render them correctly, so nobody would notice.

   Kept as literals rather than imported from PAY_METHODS in
   packages/shared/src/payment.ts, because this script is plain node with no
   build step and that module is TypeScript. If the vocabulary grows, it grows
   there first and this follows. */
export const PAY = { cash: 'cash', card: 'card', bit: 'bit', transfer: 'bank_transfer', cheque: 'cheque' };

export const TICKETS = [
  { n: 101, cust: 'dana', car: 0, st: 'paid', epic: 'service', prio: 'med', who: 'sarah-3',
    works: ['SRV-30'], created: '2026-06-11', due: '2026-06-12', payMethod: PAY.card, paidOn: '2026-06-12' },
  { n: 102, cust: 'eli', car: 0, st: 'paid', epic: 'engine', prio: 'high', who: 'adam-2',
    works: ['ENG-TB'], created: '2026-06-24', due: '2026-06-27', payMethod: PAY.transfer, paidOn: '2026-06-27' },
  { n: 103, cust: 'bendavid', car: 0, st: 'paid', epic: 'brakes', prio: 'urgent', who: 'avi-4',
    works: ['BRK-PF', 'BRK-DF'], created: '2026-07-08', due: '2026-07-09', payMethod: PAY.transfer, paidOn: '2026-07-10' },
  { n: 104, cust: 'ronit', car: 0, st: 'paid', epic: 'service', prio: 'low', who: 'sarah-3',
    works: ['SRV-10'], created: '2026-07-21', due: '2026-07-22', payMethod: PAY.cash, paidOn: '2026-07-22' },

  /* Paid today, so it sits in שולם rather than the archive — isArchived turns
     at midnight, and a demo with an empty payment column is a demo of nothing. */
  { n: 105, cust: 'omer', car: 0, st: 'paid', epic: 'ac', prio: 'med', who: 'avi-4',
    works: ['AC-GAS'], created: '2026-08-06', due: '2026-08-07', payMethod: PAY.card, paidToday: true },
  { n: 106, cust: 'ester', car: 0, st: 'paid', epic: 'service', prio: 'med', who: 'sarah-3',
    works: ['SRV-10', 'WHL-AL'], created: '2026-08-05', due: '2026-08-08', payMethod: PAY.cash, paidToday: true },

  { n: 107, cust: 'moshe', car: 0, st: 'done', epic: 'susp', prio: 'high', who: 'adam-2',
    works: ['SUS-RS'], created: '2026-08-03', due: '2026-08-08',
    notes: 'הלקוח ביקש להתקשר לפני האיסוף.' },
  { n: 108, cust: 'bendavid', car: 1, st: 'done', epic: 'service', prio: 'med', who: 'avi-4',
    works: ['SRV-30'], created: '2026-08-04', due: '2026-08-09' },

  { n: 109, cust: 'dana', car: 0, st: 'appr', epic: 'ac', prio: 'med', who: 'sarah-3',
    works: ['AC-SRV'], created: '2026-08-06', due: '2026-08-11', doneWorks: 1,
    notes: 'ריח עובש במיזוג. הוצע טיפול מלא, ממתין לאישור.' },
  { n: 110, cust: 'omer', car: 0, st: 'appr', epic: 'elec', prio: 'high', who: 'יוסי-אהר',
    works: ['ELE-CK', 'ELE-BT'], created: '2026-08-07', due: '2026-08-10', doneWorks: 1,
    notes: 'הרכב לא מניע בבוקר. נמדדה נפילת מתח במצבר.' },

  { n: 111, cust: 'eli', car: 0, st: 'todo', epic: 'brakes', prio: 'urgent', who: 'adam-2',
    works: ['BRK-PF'], created: '2026-08-08', due: '2026-08-10',
    notes: 'חריקה בבלימה. הלקוח ממתין במקום.' },
  { n: 112, cust: 'ronit', car: 0, st: 'todo', epic: 'engine', prio: 'med', who: null,
    works: ['DIA-CP'], created: '2026-08-09', due: '2026-08-12',
    notes: 'נורת מנוע דולקת.' },
  { n: 113, cust: 'moshe', car: 0, st: 'todo', epic: 'service', prio: 'low', who: null,
    works: ['SRV-10'], created: '2026-08-09', due: '2026-08-13' },
  { n: 114, cust: 'bendavid', car: 0, st: 'todo', epic: 'brakes', prio: 'high', who: 'avi-4',
    works: ['BRK-DF'], created: '2026-08-09', due: '2026-08-11', blocked: 'ממתין להגעת דיסקים מהספק',
    notes: 'הוזמנו דיסקים, צפי אספקה יומיים.' },
];
