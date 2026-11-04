/* The printed work order, as an HTML document.

   One builder for both apps, for the same reason waMessage.ts is one builder:
   there were about to be two, and two would have drifted. The web opens this in
   a window and lets the browser print it; the phone hands the same string to
   expo-print, which renders it through the platform's own print pipeline. A
   garage that prints a ticket from the counter and the same ticket from a phone
   in the bay gets one document, not two that agree about most of it.

   Deliberately not routed through either app's i18n, again for waMessage's
   reason: this is composed in the customer's language rather than the
   operator's, and translating the UI must not change what a garage hands over.

   Framework-free strings only — no DOM, no window. The web wrapper opens the
   window; the phone wrapper calls the print API. Neither belongs here. */

import { garageLetterhead, garagePrintName } from './auth';
import {
  VAT, clampDiscount, partLineTotal, workTotal, worksDiscount, type TicketWork,
} from './catalog';
import type { Car, CarOwner, Customer } from './db';
import { money } from './money';
import type { Ticket } from './types';

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

/* The one-page fit's target height, and its floor. Explained beside FIT below;
   declared up here because the work order's own layout fills to exactly it. */
const FIT_H = PAGE_H - 18;
const FIT_MIN = 0.6;

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

  /* The invoice copy says what it is, once and plainly. A printout that looked
     like the issued document would be a second paper claiming to be the same
     tax invoice — so this sits above the figures, not in the small print. */
  .copybar{margin:6px 0 0;padding:5px 10px;border-radius:6px;background:#f4f5f7;
        border:1px solid #d8dde5;color:#555;font-size:11px;font-weight:700;text-align:center}
  .copybar.void{background:#fbeaea;border-color:#e6c9c9;color:#9c3236}

  .box{background:#fff;border:1px solid #1d2d44;border-radius:11px;
        padding:13px 13px 9px;margin-top:10px}
  .box.tight{padding:9px}
  .sub-t{font-size:10.5px;font-weight:800;color:#1d2d44;letter-spacing:.3px;
        margin-bottom:3px;padding-bottom:3px;border-bottom:1px solid #e4e8ee}

  /* A box that covers one subject says so, above the columns that divide it.
     Heavier than .sub-t, which labels the columns themselves — two levels, so
     "the customer" reads as part of "customer and vehicle" rather than as its
     equal. */
  .box-t{font-size:11.5px;font-weight:800;color:#1d2d44;letter-spacing:.2px;
        margin:-2px 0 9px;padding-bottom:5px;border-bottom:1.5px solid #1d2d44}

  /* What the customer owes, said once and said loudly. */
  .sums{width:330px;margin-right:auto;margin-top:9px}
  .disc{font-size:9.5px;font-weight:700;color:#555;white-space:nowrap}
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
  /* ---- the work order: the whole sheet, in a size read across a counter ----
     It printed at 12px and stopped wherever the content did, so a two-work
     ticket was a strip of small print across the top of an empty page. Larger
     type throughout, and the sheet is a column at least the fitted page tall:
     the works frame takes up whatever is left, so the totals and the
     signatures sit at the foot of the page instead of half way down it. A long
     ticket is still shrunk to one page by FIT; this only grows a short one. */
  .sheet.wo{display:flex;flex-direction:column;min-height:${FIT_H}px}
  .sheet.wo .grow{flex:1;display:flex;flex-direction:column}
  .sheet.wo .grow .sums{margin-top:auto;padding-top:12px}
  .sheet.wo th,.sheet.wo td{font-size:14px;padding:6px 6px}
  .sheet.wo .kv th{width:120px}
  .sheet.wo .lines tr.work td.name{font-size:14.5px}
  .sheet.wo .lines tr.note td.txt{font-size:13px}
  .sheet.wo .sub-t{font-size:12.5px}
  .sheet.wo .docbar{font-size:13px}
  .sheet.wo .docbar-k{font-size:15px}
  .sheet.wo .lh-name{font-size:32px}
  .sheet.wo .lh-services{font-size:14px}
  .sheet.wo .lh-contact{font-size:12px}
  .sheet.wo .totals tr.grand th,.sheet.wo .totals tr.grand td{font-size:17px}
  .sheet.wo .grand-l{font-size:15px}
  .sheet.wo .grand-v{font-size:17px}
  .sheet.wo .note{font-size:14px}
  .sheet.wo .sigrow{font-size:13.5px;margin-top:26px}
  .sheet.wo .foot{font-size:12.5px}

  /* ---- a customer's treatment history ----
     One band per visit — date, number, car, km, what it came to — and what was
     done under it. Runs to as many pages as the customer has history; a band is
     never split across two. */
  .hist th,.hist td{font-size:13px}
  .hist tbody.v{break-inside:avoid}
  .hist tbody.v+tbody.v tr:first-child td{border-top:9px solid #fff}
  .hist tr.visit td{background:#eef1f5;font-weight:700;border-bottom:1px solid #d8dde5}
  .hist tr.did td{color:#333;padding-right:20px}
  .hist tr.did td .parts{display:block;color:#666;font-size:12px;margin-top:2px}
  .hist tfoot td{font-weight:800;font-size:14px;border-top:2px solid #1d2d44;border-bottom:0}

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

/** The whole document, ready for a window to write or a print API to take. */
export const renderPrintDoc = (
  { title, body, fit, sheetClass }: {
    title: string; body: string; fit?: boolean;
    /** Extra class on the sheet, for a document with its own layout ('wo'). */
    sheetClass?: string;
  },
): string =>
  `<!doctype html><html dir="rtl" lang="he"><head><meta charset="utf-8">`
  + `<title>${esc(title)}</title><style>${CSS}</style></head><body>`
  + `<div class="page"><div class="sheet${sheetClass ? ` ${sheetClass}` : ''}">${body}</div></div>`
  + `<button class="no-print" onclick="window.print()">הדפס</button>`
  + (fit ? `<script>${FIT}</script>` : '')
  + `</body></html>`;

const printedOn = () => `הופק ${new Date().toLocaleDateString('he-IL')}`;

/* ---------------- work order ---------------- */

export interface TicketTotals {
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
/* A discounted price prints as the list price with the percentage under it,
   and the line total beside it is already after the discount — so the sheet
   shows both what it would have cost and what it does. */
const priceCell = (price: number, pct?: number): string => {
  const d = clampDiscount(pct);
  return `<td class="n">${esc(money(price))}`
    + (d ? `<div class="disc">הנחה ${d}%</div>` : '')
    + `</td>`;
};

const workBlock = (w: TicketWork, index: number): string => {
  const note = w.notes?.trim();
  const lines = [
    ...w.items.map((p) =>
      `<tr class="line">`
      + `<td></td>`
      + `<td class="desc">${esc(p.name)}</td>`
      + `<td class="n">${esc(val(p.sku))}</td>`
      + `<td class="n">${p.qty}</td>`
      + priceCell(p.price, p.discount)
      + `<td class="n">${esc(money(partLineTotal(p)))}</td>`
      + `</tr>`),
    ...(note ? [`<tr class="note"><td></td><td class="txt" colspan="5">${esc(note)}</td></tr>`] : []),
  ].join('');

  return `<tbody class="w">`
    + `<tr class="work">`
    + `<td class="n">${index + 1}</td>`
    + `<td class="name">${esc(w.name)}</td>`
    + `<td class="n">${esc(val(w.code))}</td>`
    + `<td class="n">${w.items.length ? `${w.items.length} חלקים` : '-'}</td>`
    + priceCell(w.labor, w.laborDiscount)
    + `<td class="n">${esc(money(workTotal(w)))}</td>`
    + `</tr>`
    + lines
    + `</tbody>`;
};

/* The garage's own paper: the block every printed document opens with.
 *
 * Each line is dropped when that garage has not filled it in, so a garage with
 * nothing but a name prints exactly the header it printed before letterheads
 * existed. Nothing here has a default — a placeholder would put one garage's
 * details on another's paperwork.
 *
 * Exported because the invoice copy needs the same one. It was inlined in the
 * work order, and copying it would have been the start of two letterheads that
 * agree today. */
export const letterheadHtml = (): string => {
  const lh = garageLetterhead();
  const contact: string[] = [
    lh.address ? esc(lh.address) : '',
    lh.taxId ? `ע.מ / ח.פ.<br>${esc(lh.taxId)}` : '',
    lh.licenseNo ? `מורשה משרד התחבורה<br>${esc(lh.licenseNo)}` : '',
    [lh.phone ? `טלפון ${esc(lh.phone)}` : '', lh.fax ? `פקס ${esc(lh.fax)}` : '']
      .filter(Boolean).join('<br>'),
  ].filter(Boolean);

  return `
    ${lh.motto ? `<div class="topmotto">${esc(lh.motto)}</div>` : ''}
    <div class="lh">
      <div class="lh-name">${esc(garagePrintName())}</div>
      ${lh.services ? `<div class="lh-rule"><i></i></div>
        <div class="lh-services">${esc(lh.services)}</div>` : ''}
      ${contact.length
        ? `<div class="lh-contact">${contact.map((c) => `<span>${c}</span>`).join('')}</div>`
        : ''}
    </div>`;
};

/** What the window or the print dialog is called. */
export const workOrderTitle = (t: Ticket): string => `כרטיס עבודה ${t.k}`;

/** Totals arrive from the caller rather than being recomputed: the printed
 *  sheet and the screen must never disagree about what the customer owes. */
export const workOrderHtml = (
  t: Ticket,
  totals: TicketTotals,
  opts: { photoCount?: number } = {},
): string => {
  const works = t.works ?? [];
  /* Told, not subtracted: the totals above it are already after discounts. */
  const discount = worksDiscount(works);

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

  /* A cancelled ticket still prints — it is a kept record — but must never be
     mistaken on paper for a live job. */
  const cancelledBlock = t.st === 'cancelled'
    ? `<div class="box"><div class="sub-t">הכרטיס בוטל${
        t.cancelledAt ? ` ב-${esc(new Date(t.cancelledAt).toLocaleDateString('he-IL'))}` : ''
      }</div><div class="note">${esc(t.cancelReason ?? '')}</div></div>`
    : '';

  /* The garage's own paper. Each line is dropped when that garage has not
     filled it in, so a garage with nothing but a name prints exactly the header
     it printed before any of this existed. */
  const body = `
    ${letterheadHtml()}

    <div class="docbar">
      <span class="docbar-k">כרטיס עבודה ${esc(t.k)}${t.st === 'cancelled' ? ' · בוטל' : ''}</span>
      <span>${esc(printedOn())}${t.job ? ` · מספר עבודה ${esc(t.job)}` : ''}</span>
    </div>
    ${cancelledBlock}

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

    <div class="box tight grow">
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
          ${discount > 0 ? row('מזה הנחה', `-${money(discount)}`) : ''}
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

  return renderPrintDoc({ title: workOrderTitle(t), body, fit: true, sheetClass: 'wo' });
};

/* ---------------- a customer's treatment history ---------------- */

export const customerHistoryTitle = (c: Pick<Customer, 'name'>): string =>
  `היסטוריית טיפולים - ${c.name}`;

/** Every visit of one customer, newest first: when, which car, what was done
 *  and what it came to.
 *
 *  Cancelled tickets are left out here, by the builder rather than trusted to
 *  the caller: they are kept on file, but a customer's history is the work that
 *  was actually done. The amounts are the stored ticket totals, VAT included —
 *  the same figure the customer report and the archive show. */
export const customerHistoryHtml = (c: Customer, tickets: readonly Ticket[]): string => {
  const visits = tickets
    .filter((t) => t.st !== 'cancelled')
    .slice()
    .sort((a, b) => (b.createdAtISO ?? '').localeCompare(a.createdAtISO ?? ''));

  const visit = (t: Ticket): string => {
    const works = t.works ?? [];
    const did = works.length
      ? works.map((w) =>
          `<tr class="did"><td colspan="5">${esc(w.name)}${
            w.items.length
              ? `<span class="parts">${esc(w.items.map((p) => (p.qty === 1 ? p.name : `${p.name} ×${p.qty}`)).join(' · '))}</span>`
              : ''
          }</td></tr>`).join('')
      : `<tr class="did"><td colspan="5">${esc(t.title || '-')}</td></tr>`;
    return `<tbody class="v">`
      + `<tr class="visit">`
      + `<td>${esc(val(t.createdAt))}</td>`
      + `<td>${esc(t.k)}</td>`
      + `<td>${esc([t.plate && t.plate !== '-' ? t.plate : '', t.car].filter(Boolean).join(' · ') || '-')}</td>`
      + `<td>${esc(t.km ? `${t.km} ק״מ` : '-')}</td>`
      + `<td class="n">${esc(money(t.amount))}</td>`
      + `</tr>${did}</tbody>`;
  };

  const total = visits.reduce((sum, t) => sum + (t.amount || 0), 0);

  const body = `
    ${letterheadHtml()}

    <div class="docbar">
      <span class="docbar-k">היסטוריית טיפולים</span>
      <span>${esc(printedOn())}</span>
    </div>

    <div class="box">
      <div class="sub-t">הלקוח</div>
      <div class="cols">
        <section><table class="kv">
          ${row('שם', c.name)}
          ${row('טלפון', c.phone)}
          ${row('ת״ז / ח.פ', c.id_number)}
        </table></section>
        <section><table class="kv">
          ${row('דוא״ל', c.email)}
          ${row('כתובת', [c.address, c.city].filter(Boolean).join(', '))}
          ${row('מספר ביקורים', visits.length)}
        </table></section>
      </div>
    </div>

    <div class="box tight">
      <table class="lines hist">
        <thead>
          <tr>
            <th style="width:14%">תאריך</th>
            <th style="width:13%">כרטיס</th>
            <th style="width:36%">רכב</th>
            <th style="width:17%">קילומטראז׳</th>
            <th class="n" style="width:20%">סה״כ (₪)</th>
          </tr>
        </thead>
        ${visits.length
          ? visits.map(visit).join('')
          : `<tbody><tr><td colspan="5" style="color:#888">אין טיפולים רשומים ללקוח</td></tr></tbody>`}
        ${visits.length ? `<tfoot><tr><td colspan="4">סה״כ</td><td class="n">${esc(money(total))}</td></tr></tfoot>` : ''}
      </table>
    </div>`;

  return renderPrintDoc({ title: customerHistoryTitle(c), body });
};

/* ---------------- a car's treatment history ---------------- */

export const carHistoryTitle = (car: Pick<Car, 'plate'>): string =>
  `היסטוריית טיפולים - רכב ${car.plate}`;

/** Every visit of one car, newest first, whoever brought it in — history is per
 *  car (2026-11-04). Same rules as the customer's sheet: cancelled tickets are
 *  left out by the builder, amounts are the stored totals, VAT included. Each
 *  visit names its customer and the km read that day. */
export const carHistoryHtml = (car: Car, owners: readonly CarOwner[], tickets: readonly Ticket[]): string => {
  const visits = tickets
    .filter((t) => t.st !== 'cancelled')
    .slice()
    .sort((a, b) => (b.createdAtISO ?? '').localeCompare(a.createdAtISO ?? ''));

  const visit = (t: Ticket): string => {
    const works = t.works ?? [];
    const did = works.length
      ? works.map((w) =>
          `<tr class="did"><td colspan="5">${esc(w.name)}${
            w.items.length
              ? `<span class="parts">${esc(w.items.map((p) => (p.qty === 1 ? p.name : `${p.name} ×${p.qty}`)).join(' · '))}</span>`
              : ''
          }</td></tr>`).join('')
      : `<tr class="did"><td colspan="5">${esc(t.title || '-')}</td></tr>`;
    return `<tbody class="v">`
      + `<tr class="visit">`
      + `<td>${esc(val(t.createdAt))}</td>`
      + `<td>${esc(t.k)}</td>`
      + `<td>${esc(t.customer || '-')}</td>`
      + `<td>${esc(t.km ? `${t.km} ק״מ` : '-')}</td>`
      + `<td class="n">${esc(money(t.amount))}</td>`
      + `</tr>${did}</tbody>`;
  };

  const total = visits.reduce((sum, t) => sum + (t.amount || 0), 0);

  const body = `
    ${letterheadHtml()}

    <div class="docbar">
      <span class="docbar-k">היסטוריית טיפולים לרכב</span>
      <span>${esc(printedOn())}</span>
    </div>

    <div class="box">
      <div class="sub-t">הרכב</div>
      <div class="cols">
        <section><table class="kv">
          ${row('מספר רישוי', car.plate)}
          ${row('יצרן ודגם', [car.manufacturer, car.model].filter(Boolean).join(' '))}
          ${row('שנה', car.year)}
        </table></section>
        <section><table class="kv">
          ${row('קוד דגם', car.vehicle_code)}
          ${row('לקוחות', owners.map((o) => o.name).join(', '))}
          ${row('מספר ביקורים', visits.length)}
        </table></section>
      </div>
    </div>

    <div class="box tight">
      <table class="lines hist">
        <thead>
          <tr>
            <th style="width:14%">תאריך</th>
            <th style="width:13%">כרטיס</th>
            <th style="width:36%">לקוח</th>
            <th style="width:17%">קילומטראז׳</th>
            <th class="n" style="width:20%">סה״כ (₪)</th>
          </tr>
        </thead>
        ${visits.length
          ? visits.map(visit).join('')
          : `<tbody><tr><td colspan="5" style="color:#888">אין טיפולים רשומים לרכב</td></tr></tbody>`}
        ${visits.length ? `<tfoot><tr><td colspan="4">סה״כ</td><td class="n">${esc(money(total))}</td></tr></tfoot>` : ''}
      </table>
    </div>`;

  return renderPrintDoc({ title: carHistoryTitle(car), body });
};
