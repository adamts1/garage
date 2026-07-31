import {
  countWorkerTickets, createWorker, deleteWorker, listWorkers, subscribeToTable,
  suggestInitials, updateWorker, type Worker,
} from '@garage/shared';
import { useCallback, useEffect, useState } from 'react';
import { showError, showErrorKey, showSuccess, useAppDispatch, useConfirm } from '../../store';

export type WorkerDraft = Omit<Worker, 'id'>;

/* Codes are what tickets store, so a garage never sees them; the field exists
   because it must be unique and stable, and generating one silently would make
   a collision impossible to fix. */
export const blankWorker: WorkerDraft = {
  code: '', name: '', initials: '', color: '#3e5c76', position: 0, active: true,
};

/** Enough distinct chips for a board to stay readable. Free text would let
 *  someone pick white on white. */
export const WORKER_COLORS = [
  '#1d2d44', '#3e5c76', '#4f7a5b', '#748cab', '#8d5b4c', '#6b4f7a', '#a5763f', '#41707e',
];

export const toDraft = (w: Worker): WorkerDraft => ({
  code: w.code, name: w.name, initials: w.initials,
  color: w.color, position: w.position, active: w.active,
});

const isDuplicateCode = (e: unknown) =>
  e instanceof Error ? /duplicate key/i.test(e.message) : false;

export function useWorkers() {
  const dispatch = useAppDispatch();
  const confirm = useConfirm();
  const [rows, setRows] = useState<Worker[]>([]);

  const load = useCallback(() => {
    listWorkers().then(setRows).catch((e) => dispatch(showError(e)));
  }, [dispatch]);

  useEffect(() => {
    load();
    return subscribeToTable('garage_workers', load);
  }, [load]);

  const create = useCallback(
    async (draft: WorkerDraft) => {
      const code = draft.code.trim();
      const name = draft.name.trim();
      if (!code || !name) return false;
      try {
        await createWorker({
          ...draft,
          code,
          name,
          // Blank initials are filled from the name rather than rejected: it is
          // the field nobody wants to think about, and the column is NOT NULL.
          initials: draft.initials.trim() || suggestInitials(name),
          // New workers go last, so an existing board's order does not shuffle.
          position: rows.length,
        });
        dispatch(showSuccess('workers.created'));
        load();
        return true;
      } catch (e) {
        // The unique constraint is per (garage_id, code), so this is the failure
        // a garage will actually hit — worth saying in words, not Postgres.
        dispatch(isDuplicateCode(e) ? showErrorKey('workers.codeTaken', { code }) : showError(e));
        return false;
      }
    },
    [dispatch, load, rows.length],
  );

  const update = useCallback(
    async (id: string, draft: WorkerDraft) => {
      const name = draft.name.trim();
      if (!name) return false;
      try {
        await updateWorker(id, {
          code: draft.code.trim(),
          name,
          initials: draft.initials.trim() || suggestInitials(name),
          color: draft.color,
        });
        dispatch(showSuccess('workers.updated'));
        load();
        return true;
      } catch (e) {
        dispatch(
          isDuplicateCode(e)
            ? showErrorKey('workers.codeTaken', { code: draft.code.trim() })
            : showError(e),
        );
        return false;
      }
    },
    [dispatch, load],
  );

  /** Retiring is the reversible one, and the one a garage almost always means:
   *  the mechanic leaves the assignment picker while every ticket they closed
   *  still carries their name. */
  const toggleActive = useCallback(
    async (worker: Worker) => {
      try {
        await updateWorker(worker.id, { active: !worker.active });
        dispatch(showSuccess(worker.active ? 'workers.retired' : 'workers.reactivated'));
        load();
      } catch (e) {
        dispatch(showError(e));
      }
    },
    [dispatch, load],
  );

  /** Deleting is not reversible. `on delete set null` unassigns their tickets,
   *  so the count goes in the question — "delete" and "erase this person from
   *  34 tickets" are different decisions and the button cannot tell them apart
   *  on its own. */
  const remove = useCallback(
    async (worker: Worker) => {
      let used: number;
      try {
        used = await countWorkerTickets(worker.code);
      } catch {
        // Better to warn without a number than to block the delete on a count.
        used = -1;
      }

      const bodyKey =
        used > 0 ? 'workers.confirmDeleteWithTickets'
        : used < 0 ? 'workers.confirmDeleteUnknownCount'
        : 'workers.confirmDelete';

      const ok = await confirm({
        bodyKey,
        values: { name: worker.name, count: Math.max(used, 0) },
        danger: true,
      });
      if (!ok) return;

      try {
        await deleteWorker(worker.id);
        dispatch(showSuccess('workers.deleted'));
        load();
      } catch (e) {
        dispatch(showError(e));
      }
    },
    [confirm, dispatch, load],
  );

  return {
    rows,
    activeCount: rows.filter((w) => w.active).length,
    create,
    update,
    toggleActive,
    remove,
  };
}
