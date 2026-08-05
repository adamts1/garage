import {
  createWorkDef, deleteWorkDef, listWorkDefs, subscribeToTable, toCatalogCode, updateWorkDef,
  type WorkDef,
} from '@garage/shared';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { showError, showSuccess, useAppDispatch, useConfirm } from '../../store';

export type WorkDefDraft = Omit<WorkDef, 'id'>;

export const blankWorkDef: WorkDefDraft = {
  code: '', name: '', labor: 0, hours: 0, items: [],
};

export const toDraft = (w: WorkDef): WorkDefDraft => ({
  code: w.code, name: w.name, labor: w.labor, hours: w.hours, items: w.items,
});

/** `work_defs` is unique on (garage_id, code), and Postgres says so in a
 *  sentence nobody at a service desk can act on. Turned into one that names the
 *  actual problem. */
const DUPLICATE_CODE = '23505';
const isDuplicateCode = (e: unknown): boolean =>
  typeof e === 'object' && e !== null && (e as { code?: string }).code === DUPLICATE_CODE;

export function useWorks() {
  const dispatch = useAppDispatch();
  const confirm = useConfirm();
  const [rows, setRows] = useState<WorkDef[]>([]);
  const [query, setQuery] = useState('');

  const load = useCallback(() => {
    listWorkDefs().then(setRows).catch((e) => dispatch(showError(e)));
  }, [dispatch]);

  useEffect(() => {
    load();
    // The intake form pulls from this same catalog; a work added there — or by
    // somebody at another screen — shows up here without a refresh.
    return subscribeToTable('work_defs', load);
  }, [load]);

  /* Code and name, the two things somebody knows when they come looking for a
     work. Same rule as the parts list, which a garage's catalog outgrows just
     as quickly. */
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (w) => w.code.toLowerCase().includes(q) || w.name.toLowerCase().includes(q),
    );
  }, [rows, query]);

  const fail = useCallback(
    (e: unknown) => {
      dispatch(showError(isDuplicateCode(e) ? 'works.duplicateCode' : e));
      return false;
    },
    [dispatch],
  );

  /* Uppercase Latin, whoever is calling. The screens normalise as you type;
     this is the same rule at the write, so a code cannot arrive in Hebrew from
     a caller that forgot — the pickers used to invent exactly that. */
  const clean = (draft: WorkDefDraft): WorkDefDraft => ({ ...draft, code: toCatalogCode(draft.code) });

  const create = useCallback(
    async (raw: WorkDefDraft) => {
      const draft = clean(raw);
      if (!draft.code || !draft.name.trim()) return false;
      try {
        await createWorkDef(draft);
        dispatch(showSuccess('works.created'));
        load();
        return true;
      } catch (e) {
        return fail(e);
      }
    },
    [dispatch, fail, load],
  );

  const update = useCallback(
    async (id: string, raw: WorkDefDraft) => {
      const draft = clean(raw);
      if (!draft.code) return false;
      try {
        await updateWorkDef(id, draft);
        dispatch(showSuccess('works.updated'));
        load();
        return true;
      } catch (e) {
        return fail(e);
      }
    },
    [dispatch, fail, load],
  );

  /* Deleting a catalog work leaves every ticket that used it untouched: a
     ticket's works are its own rows, copied at the moment they were added. The
     confirmation says so, because "delete work" reads like it might not. */
  const remove = useCallback(
    async (work: WorkDef) => {
      const ok = await confirm({
        bodyKey: 'works.confirmDelete',
        values: { name: work.name },
        danger: true,
      });
      if (!ok) return;
      try {
        await deleteWorkDef(work.id);
        dispatch(showSuccess('works.deleted'));
        load();
      } catch (e) {
        dispatch(showError(e));
      }
    },
    [confirm, dispatch, load],
  );

  return { rows, shown, query, setQuery, create, update, remove };
}
