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

/** A unit price after a percent discount, to the agora. */
export const discounted = (price: number, pct?: number): number => {
  const d = clampDiscount(pct);
  return d ? round2(price * (1 - d / 100)) : price;
};

/* A price typed with the VAT already in it.

   Every price on a ticket is stored before VAT, and VAT goes on once, at the
   end. When a customer is quoted a figure that includes VAT, the line has to
   hold the price that comes back to that figure once VAT is added — 500 is
   stored as 423.73, and 423.73 + 18% is 500.00. Only the entry converts;
   nothing downstream knows a price was typed this way.

   The naive round2(gross / 1.18) does not always come back: a step of one
   agora before VAT is 1.18 agorot after it, so the nearest one is searched
   for, the same way issuableCredit does it. Some figures fall between two
   stored prices (₪2: 1.69 → 1.99, 1.70 → 2.01) and land an agora off. */

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

/** A pre-VAT price as the customer sees it, VAT added, to the agora. */
export const grossFromNet = (net: number, vatRate: number = VAT): number =>
  round2(net * (1 + vatRate));

/** What one unit of a part costs on this ticket. */
export const partUnitNet = (p: PartRow) => discounted(p.price, p.discount);
/** A part's line: quantity × the discounted unit price. */
export const partLineTotal = (p: PartRow) => p.qty * partUnitNet(p);
/** A work's labour after its discount. */
export const laborNet = (w: TicketWork) => discounted(w.labor, w.laborDiscount);

export const partsTotal = (w: TicketWork) =>
  w.items.reduce((sum, i) => sum + partLineTotal(i), 0);

export const workTotal = (w: TicketWork) => laborNet(w) + partsTotal(w);

/** How much the discounts took off, before VAT. Zero on a ticket without any. */
export const worksDiscount = (works: readonly TicketWork[]) =>
  works.reduce(
    (s, w) =>
      s + (w.labor - laborNet(w))
        + w.items.reduce((t, i) => t + i.qty * (i.price - partUnitNet(i)), 0),
    0,
  );

/** Every figure is after discounts; `discount` says how much they took off. */
export const worksSummary = (works: TicketWork[]) => {
  const parts = works.reduce((s, w) => s + partsTotal(w), 0);
  const labor = works.reduce((s, w) => s + laborNet(w), 0);
  const net = parts + labor;
  const vat = Math.round(net * VAT);
  return { parts, labor, net, vat, total: net + vat, discount: worksDiscount(works) };
};

export const fromCatalog = (def: WorkDef, uid: string): TicketWork => ({
  uid,
  code: def.code,
  name: def.name,
  labor: def.labor,
  items: def.items.map((i) => ({ ...i })),   // copy so edits don't mutate the catalog
  custom: def.id.startsWith('custom-'),
});
