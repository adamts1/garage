import {
  createStaff, listStaff, setStaffRole, subscribeToTable, suggestInitials, updateWorker,
  type GarageRole, type Staff,
} from '@garage/shared';
import { useCallback, useEffect, useState } from 'react';
import { showError, showSuccess, useAppDispatch } from '../../store';

/* The garage's people. A worker and a user are the same person now: this screen
   creates the account, the membership and the board chip together, through the
   manage-staff function — creating a login needs the service_role key, which
   cannot be in a browser.

   Code is gone from the form. It is what tickets store in `assignee`, it has to
   be unique per garage, and it is derived server-side; nobody outside the
   database ever needed to see it. */

/** What the add form collects. No code, and no position — both are decided for
 *  the caller. */
export interface StaffDraft {
  name: string;
  email: string;
  password: string;
  role: GarageRole;
  initials: string;
  color: string;
}

export const blankStaff: StaffDraft = {
  name: '', email: '', password: '', role: 'member', initials: '', color: '#3e5c76',
};

/** Enough distinct chips for a board to stay readable. Free text would let
 *  someone pick white on white. */
export const WORKER_COLORS = [
  '#1d2d44', '#3e5c76', '#4f7a5b', '#748cab', '#8d5b4c', '#6b4f7a', '#a5763f', '#41707e',
];

/** The subset the row editor changes. Identity — email, role — is not edited
 *  inline: one goes through the auth system and the other through a function
 *  that has to refuse the last admin. */
export interface WorkerEditDraft {
  name: string;
  initials: string;
  color: string;
}

export const toDraft = (w: Staff): WorkerEditDraft => ({
  name: w.name, initials: w.initials, color: w.color,
});

export function useWorkers() {
  const dispatch = useAppDispatch();
  const [rows, setRows] = useState<Staff[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    listStaff().then(setRows).catch((e) => dispatch(showError(e)));
  }, [dispatch]);

  useEffect(() => {
    load();
    return subscribeToTable('garage_workers', load);
  }, [load]);

  const create = useCallback(
    async (draft: StaffDraft) => {
      const name = draft.name.trim();
      const email = draft.email.trim().toLowerCase();
      if (!name || !email || draft.password.length < 8) return false;

      setBusy(true);
      try {
        await createStaff({
          ...draft,
          name,
          email,
          // Blank initials are filled from the name rather than rejected: it is
          // the field nobody wants to think about, and the column is NOT NULL.
          initials: draft.initials.trim() || suggestInitials(name),
        });
        dispatch(showSuccess('workers.created'));
        load();
        return true;
      } catch (e) {
        // The function speaks in sentences — "that email already has an
        // account" — so this passes the message through rather than translating
        // a Postgres error the way the old code had to.
        dispatch(showError(e));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [dispatch, load],
  );

  const update = useCallback(
    async (id: string, draft: WorkerEditDraft) => {
      const name = draft.name.trim();
      if (!name) return false;
      try {
        await updateWorker(id, {
          name,
          initials: draft.initials.trim() || suggestInitials(name),
          color: draft.color,
        });
        dispatch(showSuccess('workers.updated'));
        load();
        return true;
      } catch (e) {
        dispatch(showError(e));
        return false;
      }
    },
    [dispatch, load],
  );

  /* Retiring is the only way out, and it is reversible. It takes the person off
     the assignment picker AND out of the garage — current_garage_id() requires
     an active row — while every ticket they closed keeps their name. Deleting
     would unassign that work, which is history nobody asked to lose. */
  const toggleActive = useCallback(
    async (worker: Staff) => {
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

  /** Promote or step down. The function refuses to remove the garage's last
   *  admin, because nothing in the app could appoint another one. */
  const setRole = useCallback(
    async (worker: Staff, role: GarageRole) => {
      if (!worker.userId) return;
      setBusy(true);
      try {
        await setStaffRole(worker.userId, role);
        dispatch(showSuccess('workers.roleChanged'));
        load();
      } catch (e) {
        dispatch(showError(e));
      } finally {
        setBusy(false);
      }
    },
    [dispatch, load],
  );

  const activeCount = rows.filter((w) => w.active).length;

  return { rows, activeCount, busy, create, update, toggleActive, setRole };
}
