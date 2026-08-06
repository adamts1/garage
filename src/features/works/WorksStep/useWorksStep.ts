import { fromCatalog, type PartRow, type TicketWork } from '@garage/shared';
import { useCallback, useRef, useState } from 'react';
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

  /* The initial value is read on the FIRST render only, and on a saved ticket
     that render happens before the works have come back from the database — so
     this was null for every existing ticket and stayed null until somebody
     clicked a row. The fallback below is what actually makes a work selected;
     this is only the "which one did they click" half. */
  const [selectedUid, setSelectedUid] = useState<string | null>(works[0]?.uid ?? null);

  /* A counter, not works.length: removing a work and adding another would
     otherwise hand out a uid that is already on the ticket. */
  const seq = useRef(1);
  const nextUid = () => `w${seq.current++}`;

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

  const patchPart = useCallback(
    (uid: string, sku: string, patch: Partial<PartRow>) =>
      setWorks(
        works.map((w) =>
          w.uid === uid
            ? { ...w, items: w.items.map((i) => (i.sku === sku ? { ...i, ...patch } : i)) }
            : w,
        ),
      ),
    [setWorks, works],
  );

  const removePart = useCallback(
    (uid: string, sku: string) =>
      setWorks(
        works.map((w) => (w.uid === uid ? { ...w, items: w.items.filter((i) => i.sku !== sku) } : w)),
      ),
    [setWorks, works],
  );

  return {
    selectedUid,
    setSelectedUid,
    current,
    addWork,
    removeWork,
    patchWork,
    addPart,
    patchPart,
    removePart,
  };
}
