import { fromCatalog, type PartRow, type TicketWork } from '@garage/shared';
import { useCallback, useRef, useState } from 'react';
import { usePrompt } from '../../../store/usePrompt';
import { usePickPart, usePickWork } from '../usePickers';

export interface UseWorksStepOptions {
  works: TicketWork[];
  setWorks: (next: TicketWork[]) => void;
}

/**
 * Everything the works panel does that is not drawing. The pickers are opened
 * by awaiting a promise rather than by rendering a modal and threading four
 * callbacks into it — the modal comes from the Redux registry and reads the
 * catalogue itself.
 */
export function useWorksStep({ works, setWorks }: UseWorksStepOptions) {
  const pickWork = usePickWork();
  const pickPart = usePickPart();
  const prompt = usePrompt();

  /* The initial value is read on the FIRST render only, and on a saved ticket
     that render happens before the works have come back from the database — so
     this was null for every existing ticket and stayed null until somebody
     clicked a row. The fallback below is what actually makes a work selected;
     this is only the "which one did they click" half. */
  const [selectedUid, setSelectedUid] = useState<string | null>(works[0]?.uid ?? null);

  /* A counter, not works.length: removing a work and adding another would
     otherwise hand out a uid that is already on the ticket. And skipping past
     what the ticket already carries, because the counter starts again at w1 on
     every mount — a saved ticket reopened with a w1 on it would get a second
     one, and the selection, the row keys and the admin price check in
     save_ticket_works all tell works apart by uid. */
  const seq = useRef(1);
  const nextUid = () => {
    let uid = `w${seq.current++}`;
    while (works.some((w) => w.uid === uid)) uid = `w${seq.current++}`;
    return uid;
  };

  /* Falls back to the first work, so opening a ticket that already has works
     lands on one instead of on an empty right-hand pane. Derived rather than
     synced in an effect: an effect would render the empty state once and then
     replace it, and it would need to re-fire whenever the works arrive, are
     reordered, or the selected one is removed. Covers all three by construction.

     This is what makes the notes field reachable at all — it belongs to the
     selected work, and before this nothing was selected until you clicked. */
  const current = works.find((w) => w.uid === selectedUid) ?? works[0] ?? null;

  const addWork = useCallback(
    async (initialQuery = '') => {
      // What the ticket already carries, so the picker cannot offer it again
      // and cannot create a work under a code that is on it.
      const def = await pickWork({ initialQuery, taken: works.map((w) => w.code) });
      if (!def) return;
      // The picker filters, but the answer arrives asynchronously — a second
      // one under the same code must not land while the first is settling.
      if (def.code && works.some((w) => w.code === def.code)) return;
      const uid = nextUid();
      setWorks([...works, fromCatalog(def, uid)]);   // brings the work's parts with it
      setSelectedUid(uid);
    },
    [pickWork, setWorks, works],
  );

  /* A line in the mechanic's own words — "בדיקת רעש בגלגל קדמי" — that is not
     in the catalog and should not be. It goes onto this ticket only: no
     work_defs row, no code, no parts, and a price of zero for an admin to fill
     in on the row. `custom` because that is what it is, and because the badge
     beside the name is how the table already says "not from the catalog". */
  const addFreeWork = useCallback(async () => {
    const text = (await prompt({
      titleKey: 'works.freeWorkTitle',
      labelKey: 'works.freeTextLabel',
    }))?.trim();
    if (!text) return;
    const uid = nextUid();
    setWorks([...works, { uid, code: '', name: text, labor: 0, items: [], custom: true }]);
    setSelectedUid(uid);
  }, [prompt, setWorks, works]);

  const removeWork = useCallback(
    (uid: string) => {
      setWorks(works.filter((w) => w.uid !== uid));
      if (selectedUid === uid) setSelectedUid(null);
    },
    [selectedUid, setWorks, works],
  );

  const patchWork = useCallback(
    (uid: string, patch: Partial<TicketWork>) =>
      setWorks(works.map((w) => (w.uid === uid ? { ...w, ...patch } : w))),
    [setWorks, works],
  );

  const addPart = useCallback(async () => {
    if (!current) return;
    const part = await pickPart({ taken: current.items.map((i) => i.sku) });
    if (!part) return;
    if (current.items.some((i) => i.sku === part.sku)) return;
    patchWork(current.uid, { items: [...current.items, { ...part, qty: 1 }] });
  }, [current, patchWork, pickPart]);

  /* The part-side twin of addFreeWork: a line on the selected work that is not
     in the items catalog. No SKU — work_items.sku is nullable, and an invented
     one would be a code nobody can look up. */
  const addFreePart = useCallback(async () => {
    if (!current) return;
    const text = (await prompt({
      titleKey: 'works.freePartTitle',
      labelKey: 'works.freeTextLabel',
    }))?.trim();
    if (!text) return;
    patchWork(current.uid, { items: [...current.items, { sku: '', name: text, qty: 1, price: 0 }] });
  }, [current, patchWork, prompt]);

  /* By position, not by SKU. A free-text part has none, so two of them on one
     work would share the key '' and an edit to one would land on both. */
  const patchPart = useCallback(
    (uid: string, index: number, patch: Partial<PartRow>) =>
      setWorks(
        works.map((w) =>
          w.uid === uid
            ? { ...w, items: w.items.map((i, j) => (j === index ? { ...i, ...patch } : i)) }
            : w,
        ),
      ),
    [setWorks, works],
  );

  const removePart = useCallback(
    (uid: string, index: number) =>
      setWorks(
        works.map((w) => (w.uid === uid ? { ...w, items: w.items.filter((_, j) => j !== index) } : w)),
      ),
    [setWorks, works],
  );

  return {
    selectedUid,
    setSelectedUid,
    current,
    addWork,
    addFreeWork,
    removeWork,
    patchWork,
    addPart,
    addFreePart,
    patchPart,
    removePart,
  };
}
