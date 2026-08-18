/* Printable documents.

   `window.print()` prints the app — sidebar, buttons, tab strip and all. That is
   a screenshot of a screen, not something you hand a customer. Each function
   here opens a plain window containing only the record, laid out for A4, and
   lets the browser print that instead.

   The frame (window, stylesheet, print button) is shared so there is one print
   look for the whole app rather than one per page. ExpensesPage had the first
   version of this inline and now uses it too. */

import {
  garageLetterhead, garagePrintName, money, payMethodHe, VAT, workTotal,
  type Invoice, type Ticket, type TicketWork,
} from '@garage/shared';


export const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

/** Anything the intake form never filled in prints as '-', not as blank. */
const val = (v?: string | number | null) =>
  v === undefined || v === null || v === '' ? '-' : String(v);

/** A label/value line inside one of the detail tables. */
export const row = (label: string, value?: string | number | null) =>
  `<tr><th>${esc(label)}</th><td>${esc(val(value))}</td></tr>`;

/* A4 at 96dpi: 210mm x 297mm of paper, 15mm of margin on every side, leaving
   180mm x 267mm to print in. The window on screen draws the whole sheet —
   paper, margin and all — and lays the content out at exactly the printable
   width, so what is measured for the one-page fit below is what the printer
   will lay out, and what somebody sees before pressing print is the page they
   will get rather than a column of text floating in a browser window.

   Change the margin and all four of these move together. */
const PAPER_W = 794;
const PAPER_H = 1123;
const MARGIN = 57;
const PAGE_W = PAPER_W - MARGIN * 2;   // 680
const PAGE_H = 1009;

const CSS = `
  @page{size:A4;margin:15mm}
  *{box-sizing:border-box}
  body{font-family:Arial,Helvetica,sans-serif;padding:26px 0;color:#111;margin:0;background:#e9ecf1}
  .page{width:${PAPER_W}px;min-height:${PAPER_H}px;margin:0 auto;padding:${MARGIN}px;
        background:#fff;border:1px solid #ccd2db;box-shadow:0 2px 16px rgba(0,0,0,.16)}
  .sheet{width:${PAGE_W}px}
  h1{font-size:19px;margin:0 0 3px}
  h2{font-size:12.5px;margin:14px 0 5px;padding-bottom:3px;border-bottom:1.5px solid #1d2d44;color:#1d2d44}
  .sub{color:#666;font-size:12px}
  .head{display:flex;justify-content:space-between;align-items:flex-start;gap:24px;
        border-bottom:2.5px solid #1d2d44;padding-bottom:8px;margin-bottom:4px}
  .head .who{text-align:left;font-size:11.5px;color:#666;line-height:1.6}
  .cols{display:flex;gap:24px}
  .cols>section{flex:1;min-width:0}
  table{width:100%;border-collapse:collapse}
  th,td{text-align:right;padding:4px 5px;border-bottom:1px solid #eee;font-size:12px;
        vertical-align:top;word-break:break-word}
  .kv th{width:104px;color:#555;font-weight:600}
  .lines thead th{background:#f4f5f7;color:#1d2d44;font-weight:700;border-bottom:1.5px solid #d8dde5}
  .lines.wo thead th{background:#1d2d44;color:#fff;border-bottom:0}
  .lines td.n,.lines th.n{text-align:center;white-space:nowrap}

  /* One work and everything under it read as a block: a ruled band for the work
     itself, its lines indented beneath, and a gap before the next one. The old
     sheet was a single flat list where a work was told from a part only by
     being bold — which is not a difference you can see across a workshop. */
  .lines tbody.w{break-inside:avoid}
  .lines tbody.w+tbody.w tr:first-child td{border-top:9px solid #fff}
  .lines tr.work td{background:#eef1f5;font-weight:700;border-bottom:1px solid #d8dde5}
  .lines tr.work td.name{font-size:12.5px}
  .lines tr.line td{color:#333}
  .lines tr.line td.desc{padding-right:20px}
  .lines tr.line td.desc:before{content:"◦ ";color:#888}
  .lines tr.note td.txt{color:#555;font-size:11.5px;font-style:italic;padding-right:20px;
        white-space:pre-wrap}
  .lines tr.note td.txt:before{content:"הערה: ";font-style:normal;font-weight:700;color:#1d2d44}

  /* ---- the work order's letterhead ----
     A printed work order is the garage's own paper. It carried the garage's
     name in the corner and nothing else — no address, no telephone, no licence
     number — so a customer holding one had no way to reach whoever issued it.
     Every line below is per-garage and every line is omitted when that garage
     has not filled it in; nothing here has a default, because a default would
     put one garage's details on another's paperwork. */
  .lh{border:1.5px solid #1d2d44;border-radius:12px;padding:11px 16px 9px;text-align:center}
  /* Above the frame, not inside it: the first thing on the page. It was the top
     line of the letterhead box, which is a different claim — a motto is the
     garage's own words about itself, not one of its contact details. */
  .topmotto{text-align:center;font-size:13.5px;font-weight:800;color:#1d2d44;
        letter-spacing:.4px;margin-bottom:8px}
  .lh-name{font-size:29px;font-weight:800;color:#1d2d44;line-height:1.15;margin:1px 0}
  .lh-rule{display:flex;align-items:center;gap:9px;width:66%;margin:7px auto 5px}
  .lh-rule:before,.lh-rule:after{content:"";flex:1;height:1px;background:#c9d0da}
  .lh-rule i{width:7px;height:7px;background:#1d2d44;transform:rotate(45deg)}
  .lh-services{font-size:12.5px;font-weight:700;color:#1d2d44}
  .lh-contact{display:flex;justify-content:center;margin-top:8px;padding-top:7px;
        border-top:1px solid #e4e8ee;font-size:10.5px;color:#333;line-height:1.55}
  .lh-contact>span{padding:0 11px;border-inline-start:1px solid #e4e8ee}
  .lh-contact>span:first-child{border-inline-start:0}

  /* Which document this is, between the letterhead and the first section. */
  .docbar{display:flex;justify-content:space-between;align-items:baseline;gap:14px;
        margin:9px 3px 0;font-size:11px;color:#666}
  .docbar-k{font-size:12.5px;font-weight:800;color:#1d2d44}

  .box{background:#fff;border:1px solid #1d2d44;border-radius:11px;
        padding:13px 13px 9px;margin-top:10px}
  .box.tight{padding:9px}
  .sub-t{font-size:10.5px;font-weight:800;color:#1d2d44;letter-spacing:.3px;
        margin-bottom:3px;padding-bottom:3px;border-bottom:1px solid #e4e8ee}

  /* What the customer owes, said once and said loudly. */
  .sums{width:330px;margin-right:auto;margin-top:9px}
  .grand{display:flex;border:1.5px solid #1d2d44;border-radius:9px;overflow:hidden;margin-top:7px}
  .grand-l{flex:1;background:#1d2d44;color:#fff;font-size:13px;font-weight:800;
        padding:8px 12px;text-align:center}
  .grand-v{width:52%;background:#fff;color:#1d2d44;font-size:14.5px;font-weight:800;
        padding:8px 12px}

  /* Two signatures, one under the other, with nothing drawn round them. They
     were a pair of framed boxes side by side, which made the foot of the sheet
     as heavy as the letterhead at the top of it — and a signature needs a line
     to sign on, not a border to sit inside. */
  .sigs{margin-top:16px}
  .sigrow{display:flex;align-items:flex-end;gap:12px;margin-top:20px;font-size:11.5px}
  .sigrow b{font-weight:800;color:#1d2d44;white-space:nowrap;padding-bottom:3px}
  .sigrow .ln{flex:1;height:20px;border-bottom:1px solid #444}
  .sigrow .dt{white-space:nowrap;color:#555;padding-bottom:3px}
  .sigrow .dt i{display:inline-block;width:96px;border-bottom:1px solid #aaa;font-style:normal}

  .totals{margin-top:8px;margin-right:auto;width:290px}
  .totals th{width:auto;color:#555;font-weight:600}
  .totals td{text-align:left;font-weight:700;white-space:nowrap}
  .totals tr.grand th,.totals tr.grand td{font-size:15.5px;font-weight:800;
        border-top:2px solid #1d2d44;border-bottom:none;padding-top:7px}
  .note{white-space:pre-wrap;font-size:12px;line-height:1.5}
  .foot{margin-top:14px;padding-top:7px;border-top:1px solid #ddd;color:#888;font-size:11px}
  button{margin:18px auto 0;display:block;padding:9px 20px;font-size:14px;cursor:pointer}
  @media print{
    /* The paper is the paper now — @page draws the margin, so the on-screen
       sheet must stop drawing its own or every edge is doubled. */
    body{padding:0;background:#fff}
    .page{width:auto;min-height:0;margin:0;padding:0;border:0;box-shadow:none}
    .sheet{width:auto}
    .no-print{display:none}
    h2{break-after:avoid}
    tr{break-inside:avoid}
  }
`;

/* Keeps the document to a single sheet of paper.

   A work order that runs to two pages is two pages a garage has to keep
   together, and the second one is usually three lines and a signature block.
   Fitting was being done by hand — trim a note, drop a part — which is editing
   the record to suit the printer.

   So the whole sheet is shrunk to fit instead. `zoom` rather than `transform`:
   a transform does not change layout, so the browser would still paginate on
   the original height and print a blank second page. Measured from the live
   document at the printable width, and applied only in print, so the window on
   screen stays at full size.

   Fitted to slightly less than the page rather than to it exactly: a sheet
   scaled to 277.0mm of a 277mm box lands on a second page over a rounding
   error, and did — a five-work ticket came out as two pages with an empty
   second one.

   Floored, because there is a size below which the sheet stops being a document
   anybody can read. Past the floor a very long ticket does run over, and
   overflowing is the better failure. */
const FIT_H = PAGE_H - 18;
const FIT_MIN = 0.6;
const FIT = `(function(){
  var s=document.createElement('style');document.head.appendChild(s);
  function fit(){
    s.textContent='';
    var el=document.querySelector('.sheet');
    if(!el)return;
    var h=el.getBoundingClientRect().height;
    if(h<=${FIT_H})return;
    var k=Math.max(${FIT_MIN},${FIT_H}/h);
    s.textContent='@media print{.sheet{zoom:'+k.toFixed(3)+'}}';
  }
  window.addEventListener('beforeprint',fit);
  fit();
})();`;

/** Opens the document in its own window. False means the popup was blocked. */
export const printDocument = (
  { title, body, fit }: { title: string; body: string; fit?: boolean },
): boolean => {
  const w = window.open('', '_blank', 'width=860,height=1000');
  if (!w) return false;
  w.document.write(
    `<!doctype html><html dir="rtl" lang="he"><head><meta charset="utf-8">`
    + `<title>${esc(title)}</title><style>${CSS}</style></head><body>`
    + `<div class="page"><div class="sheet">${body}</div></div>`
    + `<button class="no-print" onclick="window.print()">הדפס</button>`
    + (fit ? `<script>${FIT}</script>` : '')
    + `</body></html>`,
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

/* One work and everything that makes up its price, as its own block.

   The header row carries the work, what its labour costs and what it comes to
   in total; underneath it are the parts, and nothing else. The labour was a
   line of its own down there among them, which put the one charge that is not
   a part in the list of parts — and on a work with no parts it had to be
   suppressed to stop it reading as a second charge. On the work's own row it is
   simply what that work's labour costs, whether or not anything was fitted.

   The per-work note prints too. It is written against the work on the ticket
   screen and it is what was actually done; leaving it off the sheet meant the
   only account of the work was its name. */
const workBlock = (w: TicketWork, index: number): string => {
  const note = w.notes?.trim();
  const lines = [
    ...w.items.map((p) =>
      `<tr class="line">`
      + `<td></td>`
      + `<td class="desc">${esc(p.name)}</td>`
      + `<td class="n">${esc(val(p.sku))}</td>`
      + `<td class="n">${p.qty}</td>`
      + `<td class="n">${esc(money(p.price))}</td>`
      + `<td class="n">${esc(money(p.qty * p.price))}</td>`
      + `</tr>`),
    ...(note ? [`<tr class="note"><td></td><td class="txt" colspan="5">${esc(note)}</td></tr>`] : []),
  ].join('');

  return `<tbody class="w">`
    + `<tr class="work">`
    + `<td class="n">${index + 1}</td>`
    + `<td class="name">${esc(w.name)}</td>`
    + `<td class="n">${esc(val(w.code))}</td>`
    + `<td class="n">${w.items.length ? `${w.items.length} חלקים` : '-'}</td>`
    + `<td class="n">${esc(money(w.labor))}</td>`
    + `<td class="n">${esc(money(workTotal(w)))}</td>`
    + `</tr>`
    + lines
    + `</tbody>`;
};

/** Totals arrive from the page rather than being recomputed: the printed sheet
 *  and the screen must never disagree about what the customer owes. */
export const printTicket = (
  t: Ticket,
  totals: TicketTotals,
  opts: { photoCount?: number } = {},
): boolean => {
  const works = t.works ?? [];

  const lines = works.length
    ? works.map(workBlock).join('')
    : `<tbody><tr><td colspan="6" style="color:#888">לא נרשמו עבודות בכרטיס</td></tr></tbody>`;

  /* Anything written about the ticket as a whole, as its own numbered section —
     and no section at all when there is nothing to put in it, rather than a
     heading over an empty box. */
  const notes = [
    t.notes?.trim() ? `<div class="note">${esc(t.notes.trim())}</div>` : '',
    t.blocked?.trim()
      ? `<div class="sub-t" style="margin-top:8px">חסימה</div>
         <div class="note">${esc(t.blocked.trim())}</div>`
      : '',
  ].join('');
  const notesBlock = notes
    ? `<div class="box"><div class="sub-t">הערות</div>${notes}</div>`
    : '';

  /* The garage's own paper. Each line is dropped when that garage has not
     filled it in, so a garage with nothing but a name prints exactly the header
     it printed before any of this existed. */
  const lh = garageLetterhead();
  const contact: string[] = [
    lh.address ? esc(lh.address) : '',
    lh.taxId ? `ע.מ / ח.פ.<br>${esc(lh.taxId)}` : '',
    lh.licenseNo ? `מורשה משרד התחבורה<br>${esc(lh.licenseNo)}` : '',
    [lh.phone ? `טלפון ${esc(lh.phone)}` : '', lh.fax ? `פקס ${esc(lh.fax)}` : '']
      .filter(Boolean).join('<br>'),
  ].filter(Boolean);

  const body = `
    ${lh.motto ? `<div class="topmotto">${esc(lh.motto)}</div>` : ''}
    <div class="lh">
      <div class="lh-name">${esc(garagePrintName())}</div>
      ${lh.services ? `<div class="lh-rule"><i></i></div>
        <div class="lh-services">${esc(lh.services)}</div>` : ''}
      ${contact.length
        ? `<div class="lh-contact">${contact.map((c) => `<span>${c}</span>`).join('')}</div>`
        : ''}
    </div>

    <div class="docbar">
      <span class="docbar-k">כרטיס עבודה ${esc(t.k)}</span>
      <span>${esc(printedOn())}${t.job ? ` · מספר עבודה ${esc(t.job)}` : ''}</span>
    </div>

    <div class="box">
      <div class="cols">
        <section>
          <div class="sub-t">הלקוח</div>
          <table class="kv">
            ${row('שם', t.customer)}
            ${row('טלפון', t.phone)}
            ${row('דוא״ל', t.email)}
            ${row('כתובת', t.address)}
          </table>
        </section>
        <section>
          <div class="sub-t">הרכב</div>
          <table class="kv">
            ${row('מספר רישוי', t.plate)}
            ${row('רכב / דגם', t.car)}
            ${row('שנת ייצור', t.year)}
            ${row('קילומטראז׳', t.km)}
            ${row('קוד רכב', t.vehicleCode)}
          </table>
        </section>
      </div>
    </div>

    <div class="box tight">
      <table class="lines wo">
        <thead>
          <tr>
            <th class="n" style="width:4%">#</th>
            <th style="width:46%">תיאור העבודה / הפריט</th>
            <th class="n" style="width:14%">קוד / מק״ט</th>
            <th class="n" style="width:10%">כמות</th>
            <th class="n" style="width:13%">מחיר יח׳ (₪)</th>
            <th class="n" style="width:13%">סה״כ (₪)</th>
          </tr>
        </thead>
        ${lines}
      </table>

      <div class="sums">
        ${works.length ? `<table class="totals">
          ${row('סה״כ עבודה', money(totals.labour))}
          ${row('סה״כ חלקים', money(totals.items))}
          ${row('סכום ביניים', money(totals.labour + totals.items))}
          ${row(`מע״מ ${Math.round(VAT * 100)}%`, money(totals.vat))}
        </table>` : ''}
        <div class="grand">
          <span class="grand-l">סה״כ מחיר כולל</span>
          <span class="grand-v">${esc(money(works.length ? totals.total : t.amount))}</span>
        </div>
      </div>
    </div>

    ${notesBlock}

    <div class="sigs">
      <div class="sigrow">
        <b>חתימת הלקוח</b><span class="ln"></span>
        <span class="dt">תאריך: <i></i></span>
      </div>
      <div class="sigrow">
        <b>חתימה וחותמת העוסק</b><span class="ln"></span>
        <span class="dt">תאריך: <i></i></span>
      </div>
    </div>

    ${opts.photoCount ? `<div class="foot">
      ${opts.photoCount} תמונות מצורפות לכרטיס (אינן נכללות בהדפסה)
    </div>` : ''}`;

  return printDocument({ title: `כרטיס עבודה ${t.k}`, body, fit: true });
};

/* ---------------- invoice ---------------- */

const DOC_LABEL: Record<Invoice['docType'], string> = {
  invoice_receipt: 'חשבונית מס-קבלה',
  tax_invoice: 'חשבונית מס',
  receipt: 'קבלה',
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
        <b>${esc(garagePrintName())}</b><br>
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
          ${row('אמצעי תשלום', payMethodHe(inv.payMethod))}
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
