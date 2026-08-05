import { garageName, money, type SupplierExpense } from '@garage/shared';
import { esc, printDocument, row, warnIfBlocked } from '../../lib/print';

const fmt = (iso: string) => new Date(iso).toLocaleDateString('he-IL');

/* Printed from our own stored record. iCount issues no printable document for
   an expense — it is not a document it creates; the printable original is the
   supplier's own invoice — so we format what we hold.

   The window, stylesheet and print button come from lib/print. What lives here
   is only which fields an expense shows. */
export const printExpense = (e: SupplierExpense) =>
  warnIfBlocked(
    printDocument({
      title: `הוצאת ספק ${e.reference ?? ''}`,
      body: `
    <div class="head">
      <div>
        <h1>רישום הוצאת ספק</h1>
        <div class="sub">${esc(e.supplierName ?? '')}</div>
      </div>
      <div class="who"><b>${esc(garageName())}</b><br>הופק ${new Date().toLocaleDateString('he-IL')}</div>
    </div>
    <table class="kv">
      ${row('ספק', e.supplierName)}
      ${row('תאריך', fmt(e.date))}
      ${row('מספר מסמך הספק', e.reference)}
      ${row('קטגוריה', e.category)}
      ${row('תיאור', e.description)}
      ${row('תשלום', e.paid ? 'שולם' : 'טרם שולם')}
      ${e.providerExpenseId ? row('אסמכתא iCount', '#' + e.providerExpenseId) : ''}
    </table>
    <table class="totals">
      ${row('סכום לפני מע״מ', money(e.subtotal))}
      ${row('מע״מ', money(e.vat))}
      <tr class="grand"><th>סה״כ</th><td>${esc(money(e.total))}</td></tr>
    </table>`,
    }),
  );
