// Which orders to the accounting provider deliver which files — per the
// software the garage's bookkeeper imports into — and what is recorded when one
// comes back.
//
// Measured against a real iCount account on 2026-11-12, with export_cards=true:
//
//   rivhit             -> movein.dat, heshin.dat, heshin.prm
//   hash_dos_long      -> movein.dat only
//   hash_win_flexible  -> heshin.dat, heshin.prm (+ movein.doc, movein.prm)
//
// The movein.dat from rivhit and from hash_dos_long are NOT interchangeable: the
// first field of every line is the movement-type code, numeric for ריווחית
// ("200", "12"), Hebrew letters for חשבשבת ("חש", "קב"). Same size, same
// everything else — which is exactly why the wrong one is dangerous: it imports.
// The heshin files are byte-for-byte identical across formats.
//
// export_cards, not export_clients / export_suppliers, is what puts the heshin
// files in the archive (iCount support, and confirmed by test).

import { exportPath, type Delivery, type FileName } from './bookkeepingFile.ts';

export type PartKind = 'all' | 'movements' | 'cards';
export type Software = 'rivhit' | 'hashavshevet';

export interface PartPlan {
  kind: PartKind;
  /** The provider's export_type. */
  format: string;
  /** Sent as export_cards. What makes the provider include heshin.*. */
  cards: boolean;
  /** What this order's archive is trusted to contain. Only these are ever
   *  taken from it — never a file of the same name from a different format. */
  provides: readonly FileName[];
}

export const PLANS: Record<Software, readonly PartPlan[]> = {
  /* One order, all three files. */
  rivhit: [
    { kind: 'all', format: 'rivhit', cards: true, provides: ['movein.dat', 'heshin.dat', 'heshin.prm'] },
  ],
  /* Two orders: no single חשבשבת format has movein.dat AND the heshin files. */
  hashavshevet: [
    { kind: 'movements', format: 'hash_dos_long', cards: false, provides: ['movein.dat'] },
    { kind: 'cards', format: 'hash_win_flexible', cards: true, provides: ['heshin.dat', 'heshin.prm'] },
  ],
};

export const isSoftware = (v: unknown): v is Software => v === 'rivhit' || v === 'hashavshevet';

/** The orders needed for the files that were ticked, each told exactly which of
 *  its files to keep. An order none of whose files were ticked is not sent. */
export function planParts(software: Software, files: readonly FileName[]): { plan: PartPlan; files: FileName[] }[] {
  return PLANS[software]
    .map((plan) => ({ plan, files: plan.provides.filter((f) => files.includes(f)) }))
    .filter((p) => p.files.length > 0);
}

/** Prefix for error messages, so a failure says which order it was. */
const LABEL: Record<PartKind, string> = {
  all: 'rivhit',
  movements: 'movein.dat',
  cards: 'heshin.dat / heshin.prm',
};

export interface PartRow {
  id: string;
  export_id: string;
  garage_id: string;
  kind: PartKind;
  files: string[];
}

/** Writes down what one delivery attempt came to, and returns the export's
 *  status afterwards. The callback and the retry both end here, so the two can
 *  never disagree about what a result means.
 *
 *   stored  -> the part is ready; the export is ready only if every part is
 *   pending -> nothing changes but the reason, which turns on the retry button
 *   failed  -> the part AND the export fail. No partial export is ever "ready". */
export async function settlePart(
  // deno-lint-ignore no-explicit-any
  admin: any,
  part: PartRow,
  delivery: Delivery,
): Promise<string> {
  if (delivery.kind === 'stored') {
    /* Old clients download through storage_path, which only ever meant
       movein.dat. Kept pointing at it so a page loaded before this deploy can
       still fetch the file. */
    if (delivery.sizes['movein.dat']) {
      await admin.from('bookkeeping_exports')
        .update({ storage_path: exportPath(part.garage_id, part.export_id, 'movein.dat') })
        .eq('id', part.export_id);
    }
    const { data, error } = await admin.rpc('bookkeeping_part_ready', {
      p_part: part.id,
      p_sizes: delivery.sizes,
    });
    if (error) throw new Error(error.message);
    return String(data);
  }

  if (delivery.kind === 'pending') {
    const reason = `${LABEL[part.kind]}: the file was not ready yet — ${delivery.attempts.join('; ')}`;
    await admin.from('bookkeeping_export_parts').update({ error: reason }).eq('id', part.id);
    /* Only while the export is still waiting. An export that already failed
       keeps the reason it failed for. */
    await admin.from('bookkeeping_exports').update({ error: reason })
      .eq('id', part.export_id).eq('status', 'requested');
    return 'requested';
  }

  const { error } = await admin.rpc('bookkeeping_part_failed', {
    p_part: part.id,
    p_error: `${LABEL[part.kind]}: ${delivery.message}`,
  });
  if (error) throw new Error(error.message);
  return 'error';
}
