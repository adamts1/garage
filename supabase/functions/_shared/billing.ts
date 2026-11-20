// What a ticket's bill comes to — the ticket's OWN works, priced exactly as
// the document will be. Shared by issue-invoice (which bills it) and
// card-payment (which must not charge a card more than it), so the two can
// never disagree about the figure. Moved here verbatim from issue-invoice on
// 2026-11-20; the screens mirror it in packages/shared/src/catalog.ts.

import type { InvoiceItem } from './provider.ts';

export const round2 = (n: number) => Math.round(n * 100) / 100;

export interface WorkItem { name: string; qty: number; price: number; discount?: number | null; vat_discount?: boolean | null }
export interface Work { name: string; labor: number; labor_discount?: number | null; labor_vat_discount?: boolean | null; work_items: WorkItem[] }

/** A unit price after a percent discount, to the agora. The provider gets the
 *  discounted price and nothing else — no discount field, no list price — so
 *  the document shows what was charged. Must match `discounted` in
 *  packages/shared/src/catalog.ts, which the screens and the print use. */
export function netUnit(price: unknown, pct: unknown): number {
  const p = Number(price);
  const d = Math.min(Math.max(Number(pct) || 0, 0), 100);
  return d ? Math.round(p * (1 - d / 100) * 100) / 100 : p;
}

/** הנחת מע״מ: a line whose shown price is what the customer pays including
 *  VAT is billed at the pre-VAT price that comes back to it, to the agora.
 *  Must match `netFromGross` / `partUnitCharged` in packages/shared/src/catalog.ts. */
export function chargedUnit(shown: number, vatDiscount: unknown, vatRate: number): number {
  if (vatDiscount !== true) return shown;
  if (!Number.isFinite(shown) || shown <= 0) return 0;
  const start = round2(shown / (1 + vatRate));
  let best = start;
  for (let step = -2; step <= 2; step++) {
    const net = round2(start + step / 100);
    if (net < 0) continue;
    const off = Math.abs(round2(net * (1 + vatRate)) - shown);
    if (off < Math.abs(round2(best * (1 + vatRate)) - shown) - 1e-9) best = net;
  }
  return best;
}

/** Which work a line was billed under: its position among the ticket's works
 *  and its name. Stored on every line, so the grouping a document is printed
 *  with is frozen with it rather than worked out later from a ticket that may
 *  have changed since. */
export interface LineWork { group: number; work: string; kind: 'work' | 'part' }

/** Build invoice lines from the ticket's OWN works: one line per work's labour,
 *  one per part, each after its discount. Prices are pre-VAT (as stored).
 *  Returns lines + pre-VAT subtotal, and for each line the work it came from. */
export function linesFromWorks(works: Work[], vatRate: number): { items: InvoiceItem[]; subtotal: number; owners: LineWork[] } {
  const items: InvoiceItem[] = [];
  const owners: LineWork[] = [];
  (works ?? []).forEach((w, group) => {
    const work = w.name || 'עבודה';
    const labour = chargedUnit(netUnit(w.labor, w.labor_discount), w.labor_vat_discount, vatRate);
    if (labour > 0) {
      items.push({ description: work, unitprice: labour, quantity: 1 });
      owners.push({ group, work, kind: 'work' });
    }
    for (const p of w.work_items ?? []) {
      const unit = chargedUnit(netUnit(p.price, p.discount), p.vat_discount, vatRate);
      if (unit !== 0) {
        items.push({ description: p.name || 'חלק', unitprice: unit, quantity: Number(p.qty) || 1, indent: true });
        owners.push({ group, work, kind: 'part' });
      }
    }
  });
  const subtotal = items.reduce((s, i) => s + i.unitprice * i.quantity, 0);
  return { items, subtotal, owners };
}

/** מחיר סופי לכרטיס: the lines re-priced to add up to exactly `net`, each cut
 *  by the same proportion. What agora rounding leaves over goes on the largest
 *  line of quantity 1; with none, one unit of the largest line is split off to
 *  carry it, and `split` names the line it came from.
 *  Must match `spreadToNet` in packages/shared/src/catalog.ts. */
export function spreadToNet(lines: InvoiceItem[], net: number): { lines: InvoiceItem[]; split: number | null } {
  const before = lines.reduce((s, l) => s + l.unitprice * l.quantity, 0);
  if (!(before > 0) || net >= before) return { lines: [...lines], split: null };
  const ratio = net / before;
  const out = lines.map((l) => ({ ...l, unitprice: round2(l.unitprice * ratio) }));
  const left = round2(net - out.reduce((s, l) => s + l.unitprice * l.quantity, 0));
  if (left === 0) return { lines: out, split: null };

  let best = -1;
  out.forEach((l, i) => {
    if (l.quantity === 1 && round2(l.unitprice + left) > 0
        && (best < 0 || l.unitprice > out[best].unitprice)) best = i;
  });
  if (best >= 0) {
    out[best] = { ...out[best], unitprice: round2(out[best].unitprice + left) };
    return { lines: out, split: null };
  }

  let big = 0;
  out.forEach((l, i) => { if (l.unitprice * l.quantity > out[big].unitprice * out[big].quantity) big = i; });
  const from = out[big];
  const unit = { ...from, quantity: 1, unitprice: round2(from.unitprice + left) };
  out.splice(big, 1, { ...from, quantity: from.quantity - 1 }, unit);
  return { lines: out, split: big };
}

export interface PricedTicket {
  items: InvoiceItem[];
  owners: LineWork[];
  subtotal: number;
  vat: number;
  total: number;
}

/** The ticket's bill: its lines, then מחיר סופי לכרטיס when one is set, then
 *  VAT. A string when there is no bill to make — the caller says why. */
export function priceTicket(
  works: Work[],
  finalPriceRaw: unknown,
  vatRate: number,
): PricedTicket | 'no priced works' | 'final price above the works' {
  let { items, subtotal, owners } = linesFromWorks(works, vatRate);
  if (items.length === 0) return 'no priced works';

  /* מחיר סופי לכרטיס. Below the lines, the difference is spread over them
     so the document itemises the work and comes to exactly this price.
     Above them it is refused, not quietly ignored: the customer was told a
     figure, and billing a different one is for a person to decide. */
  const finalPrice = finalPriceRaw == null ? null : Number(finalPriceRaw);
  if (finalPrice != null && finalPrice > 0) {
    const linesNet = round2(subtotal);
    if (finalPrice > round2(linesNet + round2(linesNet * vatRate))) return 'final price above the works';
    /* The pre-VAT price that comes back to it — or, where VAT's agora
       rounding cannot reach it, the one an agora below: never more than
       the customer was told. Must match `finalNet` in catalog.ts. */
    let target = chargedUnit(finalPrice, true, vatRate);
    while (target > 0 && round2(target + round2(target * vatRate)) > finalPrice) target = round2(target - 0.01);
    if (target < linesNet) {
      const spread = spreadToNet(items, target);
      items = spread.lines;
      if (spread.split != null) owners = [...owners.slice(0, spread.split + 1), owners[spread.split], ...owners.slice(spread.split + 1)];
      subtotal = round2(items.reduce((s, i) => s + i.unitprice * i.quantity, 0));
    }
  }
  const vat = round2(subtotal * vatRate);
  const total = round2(subtotal + vat);
  return { items, owners, subtotal, vat, total };
}
