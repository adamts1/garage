/* כולל מע״מ on a counter sale: the figures typed are what the customer pays,
   VAT included, and the document has to come to that total.

   Converting each unit price on its own (netFromGross per line) lets the agora
   rounding pile up over several lines and quantities. Instead the total is
   converted once — finalNet, the rule a ticket's final price follows — and the
   pre-VAT amount is spread back over the lines in proportion (spreadToNet).
   The document then lands on the typed total exactly, or, for the one total
   in six that agora-rounded VAT cannot reach, one agora below it: never
   above what the customer was told. */

import { finalNet, spreadToNet, VAT, type StandaloneLine } from '@garage/shared';

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface InclVatResult {
  /** Pre-VAT lines for the document. A unit may have been split off one
   *  line to carry the rounding; it keeps that line's description. */
  lines: StandaloneLine[];
  /** What was typed, VAT included. */
  gross: number;
  subtotal: number;
  vat: number;
  total: number;
}

export function inclVatLines(lines: readonly StandaloneLine[], vatRate: number = VAT): InclVatResult {
  const gross = round2(lines.reduce((s, l) => s + l.qty * l.unit_price, 0));
  if (!(gross > 0)) return { lines: [...lines], gross, subtotal: 0, vat: 0, total: 0 };
  const net = finalNet(gross, vatRate);
  const spread = spreadToNet(
    lines.map((l) => ({ desc: l.desc, quantity: l.qty, unitprice: l.unit_price })),
    net,
  );
  const out = spread.lines
    .filter((l) => l.quantity > 0)
    .map((l) => ({ desc: l.desc, qty: l.quantity, unit_price: l.unitprice }));
  const subtotal = round2(out.reduce((s, l) => s + l.qty * l.unit_price, 0));
  const vat = round2(subtotal * vatRate);
  return { lines: out, gross, subtotal, vat, total: round2(subtotal + vat) };
}
