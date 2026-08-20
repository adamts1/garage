/* Printable documents, in a browser.

   `window.print()` prints the app — sidebar, buttons, tab strip and all. That is
   a screenshot of a screen, not something you hand a customer. Each function
   here opens a plain window containing only the record, laid out for A4, and
   lets the browser print that instead.

   The work order itself is no longer built here. It moved to @garage/shared so
   the phone can print the same sheet through expo-print rather than growing a
   second copy of the layout — the mistake waMessage.ts already made once and
   had to undo. What is left in this file is the browser: opening the window,
   writing the document, and the invoice copy, which only the web has a screen
   for.

   The frame (window, stylesheet, print button) is shared so there is one print
   look for the whole app rather than one per page. ExpensesPage had the first
   version of this inline and now uses it too. */

import {
  esc, groupInvoiceLines, letterheadHtml, money, payMethodHe, renderPrintDoc, row,
  workOrderHtml, workOrderTitle,
  type Invoice, type InvoiceGroup, type InvoiceLine, type TicketTotals, type Ticket, type TicketWork,
} from '@garage/shared';

/* Re-exported: both were declared here before the move, and the expense sheet
   builds its body with them. */
export { esc, row };

/** Writes a finished document into its own window. False means the popup was
 *  blocked, which every caller reports the same way. */
const openDoc = (title: string, html: string): boolean => {
  const w = window.open('', '_blank', 'width=860,height=1000');
  if (!w) return false;
  w.document.write(html);
  w.document.close();
  // The title is in the document; naming it here too is what the taskbar reads
  // before the write lands.
  try { w.document.title = title; } catch { /* cross-origin cannot happen here */ }
  return true;
};

/** Opens a document assembled by a caller — the expense sheet. */
export const printDocument = ({ title, body }: { title: string; body: string }): boolean =>
  openDoc(title, renderPrintDoc({ title, body }));

const printedOn = () => `הופק ${new Date().toLocaleDateString('he-IL')}`;

/* ---------------- work order ---------------- */

/** The sheet a garage hands a customer. Built in @garage/shared, so the phone
 *  prints this exact document. */
export const printTicket = (
  t: Ticket,
  totals: TicketTotals,
  opts: { photoCount?: number } = {},
): boolean => openDoc(workOrderTitle(t), workOrderHtml(t, totals, opts));

/* ---------------- invoice ---------------- */

const DOC_LABEL: Record<Invoice['docType'], string> = {
  invoice_receipt: 'חשבונית מס-קבלה',
  tax_invoice: 'חשבונית מס',
  receipt: 'קבלה',
  credit_note: 'חשבונית זיכוי',
};

/** One frozen line, as a row under the work it was charged with. */
const invoiceLine = (l: InvoiceLine, kind: 'line' | 'work'): string =>
  `<tr class="${kind}">`
  + `<td></td>`
  + `<td class="${kind === 'work' ? 'name' : 'desc'}">${esc(l.desc)}</td>`
  + `<td class="n">${l.qty}</td>`
  + `<td class="n">${esc(money(l.unit_price))}</td>`
  + `<td class="n">${esc(money(l.line_total))}</td>`
  + `</tr>`;

/* A work and the lines it was billed as, laid out the way the work order lays
   out the same job: the work on a banded row carrying its labour, its parts
   indented underneath.

   Every figure here is a frozen invoice line. The works decided the grouping
   and contributed nothing else — groupInvoiceLines refuses unless they
   reproduce these lines exactly, so what is arranged is what was issued. */
const invoiceGroup = (g: InvoiceGroup, index: number): string => {
  const total = (g.labour?.line_total ?? 0) + g.parts.reduce((s, p) => s + p.line_total, 0);
  return `<tbody class="w">`
    + `<tr class="work">`
    + `<td class="n">${index + 1}</td>`
    + `<td class="name">${esc(g.name)}</td>`
    + `<td class="n">${g.parts.length ? `${g.parts.length} חלקים` : '-'}</td>`
    + `<td class="n">${g.labour ? esc(money(g.labour.unit_price)) : '-'}</td>`
    + `<td class="n">${esc(money(total))}</td>`
    + `</tr>`
    + g.parts.map((p) => invoiceLine(p, 'line')).join('')
    + `</tbody>`;
};

/** A readable copy of a stored invoice.
 *
 *  Deliberately labelled a copy: the legal document is the PDF the invoicing
 *  provider issued, and a printout of ours that looked like the original would
 *  be a second document claiming to be the same tax invoice. Everything here is
 *  read from the frozen row, so the numbers are the issued ones.
 *
 *  The ticket is passed for the two things the invoice row does not hold, and
 *  for nothing else:
 *
 *    * its works decide LAYOUT — the lines are grouped under the works they
 *      were billed as, exactly as the work order groups them, but only when
 *      they provably reproduce the frozen lines. Anything else and this prints
 *      the flat list it can vouch for. See groupInvoiceLines.
 *
 *    * its vehicle names the car. That was never on the invoice — no tax
 *      document carries a licence plate — so the ticket is the only source
 *      there is, and a copy of a garage's bill that cannot say which car it was
 *      for is missing the one thing the customer recognises.
 *
 *  The customer, by contrast, is read from the frozen row and not from the
 *  ticket: who a tax document was made out to is part of the document, and the
 *  ticket's copy of it can have moved since. So this panel is deliberately half
 *  frozen and half live, each field from the only place that can answer for
 *  it. */
export const printInvoice = (
  inv: Invoice,
  opts: { ticket?: Ticket } = {},
): boolean => {
  const label = DOC_LABEL[inv.docType];
  const t = opts.ticket;
  const groups = groupInvoiceLines(inv, t?.works);
  const cancelled = inv.status === 'cancelled';
  const hasVehicle = Boolean(t && (t.plate || t.car || t.year || t.km));

  const lines = groups
    ? groups.map(invoiceGroup).join('')
    : `<tbody>${
      inv.lines.length
        ? inv.lines.map((l) => invoiceLine(l, 'line')).join('')
        : `<tr><td colspan="5" style="color:#888">אין שורות במסמך — קבלה אינה נושאת פירוט</td></tr>`
    }</tbody>`;

  const body = `
    ${letterheadHtml()}

    <div class="docbar">
      <span class="docbar-k">${esc(label)} ${esc(inv.docnum)}</span>
      <span>${esc(printedOn())}</span>
    </div>

    <div class="copybar${cancelled ? ' void' : ''}">
      עותק להדפסה${cancelled ? ' · המסמך בוטל' : ''}
    </div>

    <div class="box">
      <div class="box-t">פרטי לקוח ורכב</div>
      <div class="cols">
        <section>
          <div class="sub-t">הלקוח</div>
          <table class="kv">
            ${row('שם', inv.customerName)}
            ${row('ת״ז / ח״פ', inv.customerIdNumber)}
            ${row('טלפון', inv.customerPhone)}
            ${row('כתובת', inv.customerAddress)}
          </table>
        </section>
        <section>
          <div class="sub-t">הרכב</div>
          ${hasVehicle ? `<table class="kv">
            ${row('מספר רישוי', t!.plate)}
            ${row('רכב / דגם', t!.car)}
            ${row('שנת ייצור', t!.year)}
            ${row('קילומטראז׳', t!.km)}
          </table>` : `<div class="note" style="color:#888">פרטי הרכב אינם זמינים למסמך זה</div>`}
        </section>
      </div>
    </div>

    <div class="box">
      <div class="box-t">פרטי חשבונית</div>
      <div class="cols">
        <section>
          <div class="sub-t">המסמך</div>
          <table class="kv">
            ${row('סוג מסמך', label)}
            ${row('מספר מסמך', inv.docnum)}
            ${row('תאריך הפקה', inv.issuedAt ? new Date(inv.issuedAt).toLocaleDateString('he-IL') : null)}
            ${row('מספר הקצאה', inv.allocationNumber)}
          </table>
        </section>
        <section>
          <div class="sub-t">תשלום ושיוך</div>
          <table class="kv">
            ${row('אמצעי תשלום', payMethodHe(inv.payMethod))}
            ${row('אסמכתא', inv.payReference)}
            ${row('כרטיס עבודה', inv.ticketKey)}
            ${row('סטטוס', cancelled ? 'בוטל' : 'תקף')}
          </table>
        </section>
      </div>
    </div>

    <div class="box tight">
      <table class="lines wo">
        <thead>
          <tr>
            <th class="n" style="width:4%">#</th>
            <th style="width:48%">תיאור העבודה / הפריט</th>
            <th class="n" style="width:14%">כמות</th>
            <th class="n" style="width:17%">מחיר יח׳ (₪)</th>
            <th class="n" style="width:17%">סה״כ (₪)</th>
          </tr>
        </thead>
        ${lines}
      </table>

      <div class="sums">
        <table class="totals">
          ${row('סכום לפני מע״מ', money(inv.subtotal))}
          ${row(`מע״מ ${Math.round(inv.vatRate * 100)}%`, money(inv.vat))}
        </table>
        <div class="grand">
          <span class="grand-l">סה״כ המסמך</span>
          <span class="grand-v">${esc(money(inv.total))}</span>
        </div>
      </div>
    </div>

    <div class="foot">
      עותק להדפסה של ${esc(label)} ${esc(inv.docnum)}. המסמך הרשמי הוא קובץ ה-PDF שהופק במערכת החשבוניות.
    </div>`;

  return openDoc(`${label} ${inv.docnum}`, renderPrintDoc({ title: `${label} ${inv.docnum}`, body, fit: true }));
};

/** Every caller does the same thing when the browser blocks the popup. */
export const warnIfBlocked = (opened: boolean) => {
  if (!opened) alert('הדפדפן חסם את חלון ההדפסה. יש לאפשר חלונות קופצים לאתר ולנסות שוב.');
};
