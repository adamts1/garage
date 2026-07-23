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
  price: number;
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
  items: PartRow[];
  custom?: boolean;       // true when it isn't in the catalog
}

export const VAT = 0.18;


/** A part as it lives in the catalog (no quantity - that's per-work). */
export type PartDef = Omit<PartRow, 'qty'>;


export const partsTotal = (w: TicketWork) =>
  w.items.reduce((sum, i) => sum + i.qty * i.price, 0);

export const workTotal = (w: TicketWork) => w.labor + partsTotal(w);

export const worksSummary = (works: TicketWork[]) => {
  const parts = works.reduce((s, w) => s + partsTotal(w), 0);
  const labor = works.reduce((s, w) => s + w.labor, 0);
  const net = parts + labor;
  const vat = Math.round(net * VAT);
  return { parts, labor, net, vat, total: net + vat };
};

export const fromCatalog = (def: WorkDef, uid: string): TicketWork => ({
  uid,
  code: def.code,
  name: def.name,
  labor: def.labor,
  items: def.items.map((i) => ({ ...i })),   // copy so edits don't mutate the catalog
  custom: def.id.startsWith('custom-'),
});
