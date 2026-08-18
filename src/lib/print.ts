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
  esc, garagePrintName, money, payMethodHe, renderPrintDoc, row, workOrderHtml,
  workOrderTitle, type Invoice, type TicketTotals, type Ticket,
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

  return openDoc(`${label} ${inv.docnum}`, renderPrintDoc({ title: `${label} ${inv.docnum}`, body }));
};

/** Every caller does the same thing when the browser blocks the popup. */
export const warnIfBlocked = (opened: boolean) => {
  if (!opened) alert('הדפדפן חסם את חלון ההדפסה. יש לאפשר חלונות קופצים לאתר ולנסות שוב.');
};
