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

  const [selectedUid, setSelectedUid] = useState<string | null>(works[0]?.uid ?? null);

  /* A counter, not works.length: removing a work and adding another would
     otherwise hand out a uid that is already on the ticket. */
  const seq = useRef(1);
  const nextUid = () => `w${seq.current++}`;

  const current = works.find((w) => w.uid === selectedUid) ?? null;

  const addWork = useCallback(
    async (initialQuery = '') => {
      const def = await pickWork({ initialQuery });
      if (!def) return;
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
