import {
  createItem, createWorkDef, isDuplicateCodeError, listItems, listWorkDefs,
  type PartDef, type WorkDef,
} from '@garage/shared';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { isConfigured } from '../../lib/supabase';
import { showError, showErrorKey, useAppDispatch } from '../../store';

export interface CatalogValue {
  /** This garage's own works. Was a constant compiled into the bundle, which
   *  meant every garage saw the same names and the same labour prices. */
  works: WorkDef[];
  /** The parts catalog — the items table, same sku/name/price shape. */
  parts: PartDef[];
  loading: boolean;
  addWork: (def: WorkDef) => void;
  addPart: (part: PartDef) => void;
}

const CatalogContext = createContext<CatalogValue | null>(null);

/* Why a refused write is reported as a reason rather than as itself: a
   duplicate code arrives from Postgres as an index name and the word
   "constraint", and that string used to be interpolated straight into the
   toast. The pickers refuse a code they can already see, so reaching here at
   all means somebody else took it in the meantime — which is what to say. */
const failureReason = (e: unknown, t: (key: string) => string): string =>
  isDuplicateCodeError(e) ? t('catalog.codeTaken')
  : e instanceof Error ? e.message
  : String(e);

/**
 * One copy of the catalogs for the whole app.
 *
 * These used to be state in App, passed down through the intake form and the
 * ticket page into WorksStep and from there into two modals. The modals now
 * open from the Redux registry, which can only carry serialisable props — so
 * they read the catalog here instead of being handed it.
 *
 * Context rather than Redux on purpose: the store holds UI state, and this is
 * server data with its own realtime story. A second copy in Redux would be a
 * second thing to keep true.
 */
export function CatalogProvider({ children }: { children: ReactNode }) {
  const dispatch = useAppDispatch();
  const { t } = useTranslation();
  const [works, setWorks] = useState<WorkDef[]>([]);
  const [parts, setParts] = useState<PartDef[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isConfigured) { setLoading(false); return; }
    let live = true;

    Promise.all([listWorkDefs(), listItems()])
      .then(([defs, items]) => {
        if (!live) return;
        setWorks(defs);
        setParts(items.map((i) => ({ sku: i.sku, name: i.name, price: i.price })));
      })
      .catch((e) => { if (live) dispatch(showError(e)); })
      .finally(() => { if (live) setLoading(false); });

    return () => { live = false; };
  }, [dispatch]);

  /* Optimistic, because the modal closes onto the works table and an empty row
     there reads as the work having been lost. If the write fails the entry is
     rolled back out of the catalog — but the work stays on the ticket, which is
     the copy the user actually cares about. */
  const addWork = useCallback(
    (def: WorkDef) => {
      setWorks((prev) => [...prev, def]);
      createWorkDef(def)
        .then((saved) => setWorks((prev) => prev.map((w) => (w.id === def.id ? saved : w))))
        .catch((e) => {
          setWorks((prev) => prev.filter((w) => w.id !== def.id));
          dispatch(showErrorKey('catalog.workNotSaved', { reason: failureReason(e, t) }));
        });
    },
    [dispatch, t],
  );

  const addPart = useCallback(
    (part: PartDef) => {
      setParts((prev) => [...prev, part]);
      createItem({ sku: part.sku, name: part.name, price: part.price, stock: 0 }).catch((e) => {
        setParts((prev) => prev.filter((p) => p.sku !== part.sku));
        dispatch(showErrorKey('catalog.partNotSaved', { reason: failureReason(e, t) }));
      });
    },
    [dispatch, t],
  );

  const value = useMemo<CatalogValue>(
    () => ({ works, parts, loading, addWork, addPart }),
    [works, parts, loading, addWork, addPart],
  );

  return <CatalogContext.Provider value={value}>{children}</CatalogContext.Provider>;
}

export function useCatalog(): CatalogValue {
  const value = useContext(CatalogContext);
  if (!value) throw new Error('useCatalog must be used inside a CatalogProvider');
  return value;
}
