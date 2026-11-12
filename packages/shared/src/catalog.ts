/* The shapes and the money arithmetic for works and their parts.

   The catalog itself used to live here as WORK_CATALOG and PARTS_CATALOG —
   constants compiled into both apps. That made every garage share one set of
   work names and one set of labour prices, and changing a price meant editing
   this file and shipping a release, App Store review included. The works now
   live in work_defs (see db.ts: listWorkDefs), and the parts catalog is the
   items table, which was always the same sku/name/price shape.

   What stays here is what is genuinely common: the types both apps pass around,
   and the arithmetic that decides what a customer owes.
   Picking a work in the wizard loads its parts table automatically. */

export interface PartRow {
  sku: string;
  name: string;
  qty: number;
  /** List price per unit, before any discount. */
  price: number;
  /** Percent off `price`, 0–100. Per line on a ticket; the catalog has none. */
  discount?: number;
  /** הנחת מע״מ: the price as shown is what the customer pays for it, VAT and
   *  all. See "VAT discount" below. Per line on a ticket; the catalog has none. */
  vatDiscount?: boolean;
}

export interface WorkDef {
  id: string;
  code: string;           // what you type in the works table to pull it in
  name: string;
  labor: number;          // price of the work itself
  hours: number;
  items: PartRow[];       // parts this work requires
}

/** A work as attached to a ticket - a copy of the definition the user can edit. */
export interface TicketWork {
  uid: string;            // unique per ticket (same work can be added twice)
  code: string;
  name: string;
  labor: number;
  /** Percent off `labor`, 0–100. Set on the ticket, never on the catalog. */
  laborDiscount?: number;
  /** הנחת מע״מ on the labour — see PartRow.vatDiscount. */
  laborVatDiscount?: boolean;
  items: PartRow[];
  custom?: boolean;       // true when it isn't in the catalog
  /** What was actually done, in the mechanic's words.
   *
   *  Belongs to this ticket's copy of the work, exactly like `name` and
   *  `labor` — writing one never touches the WorkDef it came from. Any member
   *  may write it: it records labour, it does not price it. */
  notes?: string;
}

/* A catalog code — a work's `code`, a part's `sku` — is uppercase Latin.
 *
 * It was free text, and the two "create it while you type" pickers filled it in
 * from the name when it was left blank: `name.slice(0, 6).toUpperCase()`. For a
 * Hebrew name that produces a Hebrew code — "החלפת שמן" became "החלפת" — and a
 * code in the same script as the description is not a code any more. It cannot
 * be dictated over a phone, it cannot be typed on a supplier's keypad, and in
 * an RTL table it sits in the description column's own direction, which is why
 * it reads as missing rather than as wrong.
 *
 * So: A-Z, digits, and the two separators anybody actually types. Everything
 * else is dropped rather than transliterated — a guessed Latin spelling of a
 * Hebrew word is a code nobody can predict, and the field is one keystroke to
 * fill in properly.
 */
export const toCatalogCode = (raw: string): string =>
  raw
    /* Trimmed BEFORE spaces become separators: this runs on every keystroke,
       and a trailing space that turned into a '-' would leave one hanging at
       the end of every code somebody paused in the middle of typing. A '-' the
       person typed themselves is kept, so "BRK-" can still become "BRK-01". */
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '-')
    .replace(/[^A-Z0-9\-_]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^[-_]+/, '');

/** Whether a code can be stored as it stands. Blank is not: it is the state the
 *  old fallback quietly filled in, and it prints as a dash. */
export const isValidCatalogCode = (raw: string): boolean => toCatalogCode(raw).length > 0;

export const VAT = 0.18;


/** A part as it lives in the catalog (no quantity - that's per-work). */
export type PartDef = Omit<PartRow, 'qty'>;


/* Discounts.

   A percentage per line — on a work's labour, and on each part — taken off the
   price before VAT. The discounted UNIT price is rounded to the agora, and the
   line is that times the quantity. Rounding the unit rather than the line is
   what lets the invoice carry it: a provider line is unit × quantity, so the
   unit has to be a price that exists. issue-invoice computes it the same way
   (supabase/functions/issue-invoice: netUnit) and the two must not drift. */

/** 0–100, whatever was typed. Blank, negative or nonsense is no discount. */
export const clampDiscount = (pct: unknown): number => {
  const n = Number(pct);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(n, 100);
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/* netFromGross: the pre-VAT price that becomes `gross` once VAT is added.

   The naive round2(gross / 1.18) does not always come back: a step of one
   agora before VAT is 1.18 agorot after it, so the nearest one is searched
   for, the same way issuableCredit does it. Some figures fall between two
   pre-VAT prices (₪2: 1.69 → 1.99, 1.70 → 2.01) and land an agora off. */

/** The pre-VAT price that becomes `gross` once VAT is added, to the agora. */
export const netFromGross = (gross: number, vatRate: number = VAT): number => {
  if (!Number.isFinite(gross) || gross <= 0) return 0;
  const start = round2(gross / (1 + vatRate));
  let best = start;
  for (let step = -2; step <= 2; step++) {
    const net = round2(start + step / 100);
    if (net < 0) continue;
    const off = Math.abs(round2(net * (1 + vatRate)) - gross);
    if (off < Math.abs(round2(best * (1 + vatRate)) - gross) - 1e-9) best = net;
  }
  return best;
};

/** A unit price after a percent discount, to the agora. */
export const discounted = (price: number, pct?: number): number => {
  const d = clampDiscount(pct);
  return d ? round2(price * (1 - d / 100)) : price;
};

/** What one unit of a part costs on this ticket. */
export const partUnitNet = (p: PartRow) => discounted(p.price, p.discount);
/** A part's line: quantity × the discounted unit price. */
export const partLineTotal = (p: PartRow) => p.qty * partUnitNet(p);
/** A work's labour after its discount. */
export const laborNet = (w: TicketWork) => discounted(w.labor, w.laborDiscount);

export const partsTotal = (w: TicketWork) =>
  w.items.reduce((sum, i) => sum + partLineTotal(i), 0);

export const workTotal = (w: TicketWork) => laborNet(w) + partsTotal(w);

/* VAT discount (הנחת מע״מ).

   A line marked with it keeps the price it shows — 500 stays 500 on the line,
   the sheet and the message — and the customer pays exactly that for it. The
   VAT still goes on at the end and still appears on the invoice; what changes
   is what that line is charged before VAT: the price that comes back to 500
   once VAT is added (netFromGross: 423.73). The difference is the discount,
   and the summary names it.

   Per unit, after any percent discount, to the agora — the same shape as the
   percent discount, so the invoice can carry it as an ordinary unit price.
   issue-invoice repeats it (chargedUnit there) and the two must not drift. */

const chargedUnit = (shown: number, vatDiscount?: boolean): number =>
  vatDiscount ? netFromGross(shown) : shown;

/** What one unit of a part is charged before VAT, after both discounts. */
export const partUnitCharged = (p: PartRow) => chargedUnit(partUnitNet(p), p.vatDiscount);
/** What a work's labour is charged before VAT, after both discounts. */
export const laborCharged = (w: TicketWork) => chargedUnit(laborNet(w), w.laborVatDiscount);

/** Everything a ticket's works are charged before VAT — what VAT is added to. */
export const worksCharged = (works: readonly TicketWork[]) =>
  works.reduce(
    (s, w) => s + laborCharged(w) + w.items.reduce((t, i) => t + i.qty * partUnitCharged(i), 0),
    0,
  );

/** What the VAT discounts took off. Zero on a ticket without any. */
export const worksVatDiscount = (works: readonly TicketWork[]) =>
  round2(works.reduce((s, w) => s + workTotal(w), 0) - worksCharged(works));

/** How much the discounts took off, before VAT. Zero on a ticket without any. */
export const worksDiscount = (works: readonly TicketWork[]) =>
  works.reduce(
    (s, w) =>
      s + (w.labor - laborNet(w))
        + w.items.reduce((t, i) => t + i.qty * (i.price - partUnitNet(i)), 0),
    0,
  );

/* A final price for the whole ticket (מחיר סופי לכרטיס).

   An admin types what the customer pays for the visit, VAT included. The lines
   keep their prices; the difference is a discount on the ticket as a whole,
   said in the summary and spread over the lines only on the invoice (see
   spreadToNet). Only ever a discount: a price above what the lines come to is
   not applied, and the screen offers to put the difference on a work's labour
   instead — a line with no reason on it is not something to bill a customer.

   Null or zero means none was set. */

/** The pre-VAT amount the ticket is charged under its final price, or null
 *  when the final price does not apply — none set, or not below the lines. */
export const finalPriceNet = (
  works: readonly TicketWork[],
  finalPrice: number | null | undefined,
  vatRate: number = VAT,
): number | null => {
  if (!finalPrice || !(finalPrice > 0)) return null;
  const target = finalNet(finalPrice, vatRate);
  return target < round2(worksCharged(works)) ? target : null;
};

/** The pre-VAT amount whose total with VAT is the final price — or, where the
 *  agora rounding of VAT makes that total unreachable (about one price in six),
 *  the one an agora below it: never more than the customer was told.
 *  issue-invoice repeats this (finalNet there). */
export const finalNet = (finalPrice: number, vatRate: number = VAT): number => {
  let net = netFromGross(finalPrice, vatRate);
  while (net > 0 && round2(net + round2(net * vatRate)) > finalPrice) net = round2(net - 0.01);
  return net;
};

/** How far a final price is ABOVE what the lines come to with VAT, or 0. The
 *  screen refuses such a price and offers to put this on a labour instead. */
export const finalPriceExcess = (
  works: readonly TicketWork[],
  finalPrice: number | null | undefined,
  vatRate: number = VAT,
): number => {
  if (!finalPrice || !(finalPrice > 0)) return 0;
  const net = round2(worksCharged(works));
  const total = round2(net + round2(net * vatRate));
  return finalPrice > total ? round2(finalPrice - total) : 0;
};

export interface SpreadLine { unitprice: number; quantity: number }

/** The lines re-priced so they add up to exactly `net`, each cut by the same
 *  proportion. Unit prices are to the agora, so what that leaves over goes on
 *  one line of quantity 1 — the largest — and when every line has a larger
 *  quantity, one unit of the largest is split off to carry it. `split` says
 *  which line was split (its index in the input), so the caller can copy what
 *  else it keeps per line. Lines are returned in their order, a split-off unit
 *  right after the line it came from.
 *
 *  issue-invoice repeats this (spreadToNet there) and the two must not drift. */
export function spreadToNet<L extends SpreadLine>(
  lines: readonly L[],
  net: number,
): { lines: L[]; split: number | null } {
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

  /* No line of one: take a unit off the largest line and let it carry the
     rest, under the same description. */
  let big = 0;
  out.forEach((l, i) => { if (l.unitprice * l.quantity > out[big].unitprice * out[big].quantity) big = i; });
  const from = out[big];
  const unit = { ...from, quantity: 1, unitprice: round2(from.unitprice + left) };
  out.splice(big, 1, { ...from, quantity: from.quantity - 1 }, unit);
  return { lines: out, split: big };
}

/** `parts` and `labor` are the lines as shown, after percent discounts;
 *  `discount` says how much those took off. `vatDiscount` comes off them, and
 *  then `ticketDiscount` — what a final price for the whole ticket takes off —
 *  to give `net`, what VAT is added to.
 *
 *  VAT is to the agora. It was to the whole shekel, which put the phone a few
 *  agorot off the web and the invoice, and a VAT-discounted ₪500 at ₪499.73. */
export const worksSummary = (works: TicketWork[], finalPrice?: number | null) => {
  const parts = works.reduce((s, w) => s + partsTotal(w), 0);
  const labor = works.reduce((s, w) => s + laborNet(w), 0);
  const charged = round2(worksCharged(works));
  const fixed = finalPriceNet(works, finalPrice);
  const net = fixed ?? charged;
  const vat = round2(net * VAT);
  return {
    parts, labor, net, vat, total: round2(net + vat),
    discount: worksDiscount(works), vatDiscount: worksVatDiscount(works),
    ticketDiscount: fixed == null ? 0 : round2(charged - fixed),
  };
};

export const fromCatalog = (def: WorkDef, uid: string): TicketWork => ({
  uid,
  code: def.code,
  name: def.name,
  labor: def.labor,
  items: def.items.map((i) => ({ ...i })),   // copy so edits don't mutate the catalog
  custom: def.id.startsWith('custom-'),
});
