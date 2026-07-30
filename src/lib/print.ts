/* Printable documents.

   `window.print()` prints the app — sidebar, buttons, tab strip and all. That is
   a screenshot of a screen, not something you hand a customer. Each function
   here opens a plain window containing only the record, laid out for A4, and
   lets the browser print that instead.

   The frame (window, stylesheet, print button) is shared so there is one print
   look for the whole app rather than one per page. ExpensesPage had the first
   version of this inline and now uses it too. */

import {
  COLUMNS, PRIORITIES, VAT, garageName, partsTotal,
  type Invoice, type Ticket,
} from '@garage/shared';

const money = (n: number) =>
  '₪' + n.toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

/** Anything the intake form never filled in prints as '-', not as blank. */
const val = (v?: string | number | null) =>
  v === undefined || v === null || v === '' ? '-' : String(v);

/** A label/value line inside one of the detail tables. */
export const row = (label: string, value?: string | number | null) =>
  `<tr><th>${esc(label)}</th><td>${esc(val(value))}</td></tr>`;

const CSS = `
  *{box-sizing:border-box}
  body{font-family:Arial,Helvetica,sans-serif;padding:32px;color:#111;margin:0}
  h1{font-size:21px;margin:0 0 4px}
  h2{font-size:14px;margin:26px 0 8px;padding-bottom:6px;border-bottom:2px solid #1d2d44;color:#1d2d44}
  .sub{color:#666;font-size:12.5px}
  .head{display:flex;justify-content:space-between;align-items:flex-start;gap:24px;
        border-bottom:3px solid #1d2d44;padding-bottom:12px;margin-bottom:8px}
  .head .who{text-align:left;font-size:12.5px;color:#666;line-height:1.7}
  .cols{display:flex;gap:28px}
  .cols>section{flex:1;min-width:0}
  table{width:100%;border-collapse:collapse}
  th,td{text-align:right;padding:7px 6px;border-bottom:1px solid #eee;font-size:13px;
        vertical-align:top;word-break:break-word}
  .kv th{width:150px;color:#555;font-weight:600}
  .lines thead th{background:#f4f5f7;color:#1d2d44;font-weight:700;border-bottom:2px solid #d8dde5}
  .lines td.n,.lines th.n{text-align:center;white-space:nowrap}
  .lines tr.work td{font-weight:700}
  .lines tr.part td{color:#444;font-size:12.5px}
  .lines tr.part td.desc{padding-right:22px}
  .totals{margin-top:14px;margin-right:auto;width:320px}
  .totals th{width:auto;color:#555;font-weight:600}
  .totals td{text-align:left;font-weight:700;white-space:nowrap}
  .totals tr.grand th,.totals tr.grand td{font-size:17px;font-weight:800;
        border-top:2px solid #1d2d44;border-bottom:none;padding-top:10px}
  .note{white-space:pre-wrap;font-size:13px;line-height:1.6}
  .foot{margin-top:34px;padding-top:10px;border-top:1px solid #ddd;color:#888;font-size:11.5px}
  .sign{margin-top:34px;display:flex;gap:40px}
  .sign div{flex:1;border-top:1px solid #999;padding-top:6px;font-size:12px;color:#555}
  button{margin-top:28px;padding:9px 20px;font-size:14px;cursor:pointer}
  @media print{
    body{padding:0}
    .no-print{display:none}
    h2{break-after:avoid}
    tr{break-inside:avoid}
  }
`;

/** Opens the document in its own window. False means the popup was blocked. */
export const printDocument = ({ title, body }: { title: string; body: string }): boolean => {
  const w = window.open('', '_blank', 'width=860,height=1000');
  if (!w) return false;
  w.document.write(
    `<!doctype html><html dir="rtl" lang="he"><head><meta charset="utf-8">`
    + `<title>${esc(title)}</title><style>${CSS}</style></head><body>${body}`
    + `<button class="no-print" onclick="window.print()">הדפס</button></body></html>`,
  );
  w.document.close();
  return true;
};

const printedOn = () => `הופק ${new Date().toLocaleDateString('he-IL')}`;

/* ---------------- work order ---------------- */

interface TicketTotals {
  labour: number;
  items: number;
  vat: number;
  total: number;
}

/** Totals arrive from the page rather than being recomputed: the printed sheet
 *  and the screen must never disagree about what the customer owes. */
export const printTicket = (
  t: Ticket,
  totals: TicketTotals,
  opts: { workerName?: string; photoCount?: number } = {},
): boolean => {
  const works = t.works ?? [];
  const status = COLUMNS.find((c) => c.id === t.st)?.title ?? t.st;
  const priority = PRIORITIES[t.prio]?.t ?? t.prio;

  const lines = works.length
    ? works.map((w) => [
        `<tr class="work">`
        + `<td class="n">${esc(val(w.code))}</td>`
        + `<td>${esc(w.name)}</td>`
        + `<td class="n">1</td>`
        + `<td class="n">${esc(money(w.labor))}</td>`
        + `<td class="n">${esc(money(w.labor + partsTotal(w)))}</td>`
        + `</tr>`,
        ...w.items.map((p) =>
          `<tr class="part">`
          + `<td class="n">${esc(val(p.sku))}</td>`
          + `<td class="desc">${esc(p.name)}</td>`
          + `<td class="n">${p.qty}</td>`
          + `<td class="n">${esc(money(p.price))}</td>`
          + `<td class="n">${esc(money(p.qty * p.price))}</td>`
          + `</tr>`),
      ].join(''))
      .join('')
    : `<tr><td colspan="5" style="color:#888">לא נרשמו עבודות בכרטיס</td></tr>`;

  /* A ticket with no works never got a priced breakdown — its amount is the
     figure someone typed. Printing a ₪0 VAT line against it would be a lie. */
  const totalsTable = works.length
    ? `<table class="totals">
         ${row('סה״כ עבודה', money(totals.labour))}
         ${row('סה״כ חלקים', money(totals.items))}
         ${row('סכום ביניים', money(totals.labour + totals.items))}
         ${row(`מע״מ ${Math.round(VAT * 100)}%`, money(totals.vat))}
         <tr class="grand"><th>סה״כ לתשלום</th><td>${esc(money(totals.total))}</td></tr>
       </table>`
    : `<table class="totals">
         <tr class="grand"><th>סה״כ לתשלום</th><td>${esc(money(t.amount))}</td></tr>
       </table>`;

  const body = `
    <div class="head">
      <div>
        <h1>כרטיס עבודה ${esc(t.k)}</h1>
        <div class="sub">${esc(t.title || '')}</div>
      </div>
      <div class="who">
        <b>${esc(garageName())}</b><br>
        ${esc(printedOn())}<br>
        מספר עבודה ${esc(val(t.job))}
      </div>
    </div>

    <div class="cols">
      <section>
        <h2>פרטי לקוח</h2>
        <table class="kv">
          ${row('שם', t.customer)}
          ${row('טלפון', t.phone)}
          ${row('דוא״ל', t.email)}
          ${row('כתובת', t.address)}
        </table>
      </section>
      <section>
        <h2>פרטי רכב</h2>
        <table class="kv">
          ${row('מספר רישוי', t.plate)}
          ${row('רכב', t.car)}
          ${row('שנה', t.year)}
          ${row('קילומטראז׳', t.km)}
        </table>
      </section>
    </div>

    <h2>סטטוס הכרטיס</h2>
    <table class="kv">
      ${row('סטטוס', status)}
      ${row('דחיפות', priority)}
      ${row('אחראי', opts.workerName)}
      ${row('נפתח בתאריך', t.createdAt)}
      ${row('תאריך יעד', t.due && t.due !== '-' ? t.due : null)}
      ${row('תשלום', t.paid ? `שולם${t.payMethod ? ` · ${t.payMethod}` : ''}` : 'טרם שולם')}
      ${t.doc ? row('מסמך', t.doc) : ''}
    </table>

    <h2>עבודות ופריטים</h2>
    <table class="lines">
      <thead>
        <tr>
          <th class="n" style="width:88px">קוד / מק״ט</th>
          <th>תיאור</th>
          <th class="n" style="width:56px">כמות</th>
          <th class="n" style="width:88px">מחיר</th>
          <th class="n" style="width:96px">סה״כ</th>
        </tr>
      </thead>
      <tbody>${lines}</tbody>
    </table>
    ${totalsTable}

    ${t.subtasks.length ? `
      <h2>משימות (${t.done}/${t.subtasks.length})</h2>
      <table>${t.subtasks.map((s, i) =>
        `<tr><td class="n" style="width:28px">${i < t.done ? '✓' : '☐'}</td><td>${esc(s)}</td></tr>`).join('')}
      </table>` : ''}

    ${t.notes ? `<h2>הערות</h2><div class="note">${esc(t.notes)}</div>` : ''}
    ${t.blocked ? `<h2>חסימה</h2><div class="note">${esc(t.blocked)}</div>` : ''}

    <div class="sign">
      <div>חתימת הלקוח</div>
      <div>חתימת המוסך</div>
    </div>

    <div class="foot">
      ${esc(t.k)} · ${esc(printedOn())}
      ${opts.photoCount ? ` · ${opts.photoCount} תמונות מצורפות לכרטיס (אינן נכללות בהדפסה)` : ''}
    </div>`;

  return printDocument({ title: `כרטיס עבודה ${t.k}`, body });
};

/* ---------------- invoice ---------------- */

const DOC_LABEL: Record<Invoice['docType'], string> = {
  invoice_receipt: 'חשבונית מס-קבלה',
  credit_note: 'חשבונית זיכוי',
};

/** A readable copy of a stored invoice.
 *
 *  Deliberately labelled a copy: the legal document is the PDF the invoicing
 *  provider issued, and a printout of ours that looked like the original would
 *  be a second document claiming to be the same tax invoice. Everything here is
 *  read from the frozen row, so the numbers are the issued ones. */
export const printInvoice = (inv: Invoice): boolean => {
  const label = DOC_LABEL[inv.docType];
  const lines = inv.lines.length
    ? inv.lines.map((l) =>
        `<tr>`
        + `<td>${esc(l.desc)}</td>`
        + `<td class="n">${l.qty}</td>`
        + `<td class="n">${esc(money(l.unit_price))}</td>`
        + `<td class="n">${esc(money(l.line_total))}</td>`
        + `</tr>`).join('')
    : `<tr><td colspan="4" style="color:#888">אין שורות במסמך</td></tr>`;

  const body = `
    <div class="head">
      <div>
        <h1>${esc(label)} ${esc(inv.docnum)}</h1>
        <div class="sub">עותק להדפסה${inv.status === 'cancelled' ? ' · המסמך בוטל' : ''}</div>
      </div>
      <div class="who">
        <b>${esc(garageName())}</b><br>
        ${esc(printedOn())}
      </div>
    </div>

    <div class="cols">
      <section>
        <h2>פרטי הלקוח</h2>
        <table class="kv">
          ${row('לקוח', inv.customerName)}
          ${row('ת״ז / ח״פ', inv.customerIdNumber)}
        </table>
      </section>
      <section>
        <h2>פרטי המסמך</h2>
        <table class="kv">
          ${row('סוג מסמך', label)}
          ${row('תאריך הפקה', inv.issuedAt ? new Date(inv.issuedAt).toLocaleDateString('he-IL') : null)}
          ${row('מספר הקצאה', inv.allocationNumber)}
          ${row('אמצעי תשלום', inv.payMethod)}
          ${row('כרטיס עבודה', inv.ticketKey)}
        </table>
      </section>
    </div>

    <h2>פירוט</h2>
    <table class="lines">
      <thead>
        <tr>
          <th>תיאור</th>
          <th class="n" style="width:56px">כמות</th>
          <th class="n" style="width:96px">מחיר יח׳</th>
          <th class="n" style="width:104px">סה״כ</th>
        </tr>
      </thead>
      <tbody>${lines}</tbody>
    </table>

    <table class="totals">
      ${row('סכום לפני מע״מ', money(inv.subtotal))}
      ${row(`מע״מ ${Math.round(inv.vatRate * 100)}%`, money(inv.vat))}
      <tr class="grand"><th>סה״כ</th><td>${esc(money(inv.total))}</td></tr>
    </table>

    <div class="foot">
      עותק להדפסה של ${esc(label)} ${esc(inv.docnum)}. המסמך הרשמי הוא קובץ ה-PDF שהופק במערכת החשבוניות.
    </div>`;

  return printDocument({ title: `${label} ${inv.docnum}`, body });
};

/** Every caller does the same thing when the browser blocks the popup. */
export const warnIfBlocked = (opened: boolean) => {
  if (!opened) alert('הדפדפן חסם את חלון ההדפסה. יש לאפשר חלונות קופצים לאתר ולנסות שוב.');
};
