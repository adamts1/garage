/* כולל מע״מ on a counter sale: the figures typed are what the customer pays,
   VAT included, and the document has to come to that total.

   Converting each unit price on its own lets the agora rounding pile up over
   several lines and quantities. Instead the total is converted once (finalNet,
   the rule a ticket's final price follows), every line is cut by the same
   proportion, and what rounding leaves over is carried by one line:

     * the largest line of quantity 1, if there is one;
     * else one unit split off the largest line with a whole quantity;
     * else — every quantity a fraction (0.7 ליטר) — the largest line is billed
       as one line at its line total, since no agora unit price times a
       fraction can be trusted to land on the agora.

   The result is checked, not assumed: the total is never above what was typed
   and at most one agora below it (about one total in six cannot be reached
   once VAT is rounded to the agora). */

import { finalNet, VAT, type StandaloneLine } from '@garage/shared';

const round2 = (n: number) => Math.round(n * 100) / 100;
const sumOf = (lines: readonly StandaloneLine[]) => lines.reduce((s, l) => s + l.qty * l.unit_price, 0);
const whole = (q: number) => Number.isInteger(q);

export interface InclVatResult {
  /** Pre-VAT lines for the document. */
  lines: StandaloneLine[];
  /** What was typed, VAT included. */
  gross: number;
  subtotal: number;
  vat: number;
  total: number;
}

export function inclVatLines(lines: readonly StandaloneLine[], vatRate: number = VAT): InclVatResult {
  const gross = round2(sumOf(lines));
  if (!(gross > 0)) return { lines: [...lines], gross, subtotal: 0, vat: 0, total: 0 };
  const net = finalNet(gross, vatRate);
  const ratio = net / sumOf(lines);
  const out: StandaloneLine[] = lines.map((l) => ({ ...l, unit_price: round2(l.unit_price * ratio) }));

  const largest = (ok: (l: StandaloneLine) => boolean) => {
    let best = -1;
    out.forEach((l, i) => { if (ok(l) && (best < 0 || l.qty * l.unit_price > out[best].qty * out[best].unit_price)) best = i; });
    return best;
  };

  /* The carrier: a line of quantity 1 whose unit price absorbs the rest. */
  let carrier = largest((l) => l.qty === 1 && l.unit_price > 0);
  if (carrier < 0) {
    const split = largest((l) => whole(l.qty) && l.qty >= 2 && l.unit_price > 0);
    if (split >= 0) {
      const from = out[split];
      out.splice(split, 1, { ...from, qty: from.qty - 1 }, { ...from, qty: 1 });
      carrier = split + 1;
    } else {
      carrier = largest((l) => l.unit_price > 0);
      const from = out[carrier];
      out[carrier] = { ...from, qty: 1, unit_price: round2(from.qty * from.unit_price) };
    }
  }

  /* Added up the way issue-invoice adds them — every line, then one rounding
     — so the screen and the document agree to the agora. */
  const subtotalOf = (ls: readonly StandaloneLine[]) => round2(sumOf(ls));
  const totalOf = (ls: readonly StandaloneLine[]) => {
    const sub = subtotalOf(ls);
    return round2(sub + round2(sub * vatRate));
  };

  /* The carrier takes what is left, then a few agorot either way are tried
     and the highest total not above the typed one wins. A fractional line
     can add half an agora, which steps over the exact total; nudging that
     line by an agora as well gets past it. */
  const start = round2(net - sumOf(out.filter((_, i) => i !== carrier)));
  const frac = largest((l) => !whole(l.qty));
  const fracAt = frac >= 0 && frac !== carrier ? frac : -1;
  let best: StandaloneLine[] | null = null;
  for (let f = -2; f <= 2; f++) {
    if (f !== 0 && fracAt < 0) continue;
    for (let c = -5; c <= 5; c++) {
      const unit = round2(start + c / 100);
      if (unit <= 0) continue;
      const try_ = out.map((l, i) => (i === carrier ? { ...l, unit_price: unit }
        : i === fracAt ? { ...l, unit_price: round2(l.unit_price + f / 100) } : l));
      if (try_.some((l) => l.unit_price < 0)) continue;
      const total = totalOf(try_);
      if (total > gross) continue;
      if (!best || total > totalOf(best)) best = try_;
    }
  }
  const final = best ?? out;

  const subtotal = subtotalOf(final);
  const vat = round2(subtotal * vatRate);
  return { lines: final, gross, subtotal, vat, total: round2(subtotal + vat) };
}
