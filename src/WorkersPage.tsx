import { useCallback, useEffect, useState } from 'react';
import {
  countWorkerTickets, createWorker, deleteWorker, listWorkers, subscribeToTable,
  suggestInitials, updateWorker, type Worker,
} from '@garage/shared';

/* The garage's own staff. Until 2026-07-30 this list was four invented people
   hardcoded in packages/shared/src/types.ts, identical for every garage and
   only changeable by shipping a release. This is the screen that replaced them.

   Deliberately plain: the same panel-header / crud-form / item-list markup as
   ItemsPage, so it inherits the existing styles rather than introducing a
   second visual language for the same kind of table. */

type Draft = Omit<Worker, 'id'>;

/* Codes are what tickets store, so a garage never sees them; the field is here
   because it must be unique and stable, and generating one silently would make
   a collision impossible to fix. */
const blank: Draft = { code: '', name: '', initials: '', color: '#3e5c76', position: 0, active: true };

/* Enough distinct chips for a garage's board to stay readable. Free text would
   let someone pick white on white. */
const COLORS = ['#1d2d44', '#3e5c76', '#4f7a5b', '#748cab', '#8d5b4c', '#6b4f7a', '#a5763f', '#41707e'];

export default function WorkersPage() {
  const [rows, setRows] = useState<Worker[]>([]);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Draft>(blank);
  const [editing, setEditing] = useState<string | null>(null);
  const [edit, setEdit] = useState<Draft>(blank);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
    listWorkers().then(setRows).catch((e) => setErr(e.message));
  }, []);

  useEffect(() => {
    load();
    return subscribeToTable('garage_workers', load);
  }, [load]);

  const add = async () => {
    const code = draft.code.trim();
    const name = draft.name.trim();
    if (!code || !name) return;
    setErr(null);
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
      setDraft(blank);
      setAdding(false);
      load();
    } catch (e: any) {
      // The unique constraint is per (garage_id, code), so this is the message a
      // garage will actually hit — worth translating out of Postgres-speak.
      setErr(/duplicate key/i.test(e.message) ? `הקוד ${code} כבר בשימוש במוסך` : e.message);
    }
  };

  const save = async (id: string) => {
    const name = edit.name.trim();
    if (!name) return;
    setErr(null);
    try {
      await updateWorker(id, {
        code: edit.code.trim(),
        name,
        initials: edit.initials.trim() || suggestInitials(name),
        color: edit.color,
      });
      setEditing(null);
      load();
    } catch (e: any) {
      setErr(/duplicate key/i.test(e.message) ? `הקוד ${edit.code} כבר בשימוש במוסך` : e.message);
    }
  };

  /* Retiring is the reversible one, and the one a garage almost always means:
     the mechanic leaves the assignment picker while every ticket they closed
     still carries their name. */
  const toggleActive = async (w: Worker) => {
    setErr(null);
    try {
      await updateWorker(w.id, { active: !w.active });
      load();
    } catch (e: any) { setErr(e.message); }
  };

  /* Deleting is not. `on delete set null (assignee)` unassigns their tickets,
     so the count goes in the confirmation — "delete" and "erase this person
     from 34 tickets" are different decisions and the button cannot tell them
     apart on its own. */
  const remove = async (w: Worker) => {
    setErr(null);
    let used = 0;
    try {
      used = await countWorkerTickets(w.code);
    } catch {
      // Better to warn without a number than to block the delete on a count.
      used = -1;
    }
    const warning = used > 0
      ? `\n\n${used} כרטיסים משויכים ל${w.name} ויישארו ללא אחראי. כדי לשמור את השיוך, השתמשו ב"השבת" במקום.`
      : used < 0
        ? '\n\nלא ניתן לבדוק כמה כרטיסים משויכים. כרטיסים משויכים יישארו ללא אחראי.'
        : '';
    if (!confirm(`למחוק את ${w.name}?${warning}`)) return;
    try {
      await deleteWorker(w.id);
      load();
    } catch (e: any) { setErr(e.message); }
  };

  const startEdit = (w: Worker) => {
    setEditing(w.id);
    setEdit({
      code: w.code, name: w.name, initials: w.initials,
      color: w.color, position: w.position, active: w.active,
    });
  };

  const activeCount = rows.filter((w) => w.active).length;

  return (
    <>
      <div className="panel-header">
        <h2>עובדי המוסך <span className="count-pill">{activeCount}</span></h2>
        <button className="btn primary" onClick={() => setAdding((v) => !v)}>
          {adding ? 'ביטול' : 'הוסף עובד'}
        </button>
      </div>

      {err && <div className="db-error">{err}</div>}

      {!rows.length && !adding && (
        <p className="text-muted">
          אין עדיין עובדים. כרטיסים ייווצרו ללא אחראי עד שיתווסף עובד ראשון.
        </p>
      )}

      {adding && (
        <div className="crud-form">
          <input
            placeholder="קוד (למשל dk)"
            value={draft.code}
            onChange={(e) => setDraft({ ...draft, code: e.target.value })}
            autoFocus
          />
          <input
            placeholder="שם מלא"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
          <input
            placeholder={draft.name ? suggestInitials(draft.name) : 'ראשי תיבות'}
            value={draft.initials}
            onChange={(e) => setDraft({ ...draft, initials: e.target.value })}
          />
          <select value={draft.color} onChange={(e) => setDraft({ ...draft, color: e.target.value })}>
            {COLORS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <span className="avatar-sm" style={{ background: draft.color }}>
            {draft.initials.trim() || suggestInitials(draft.name) || '—'}
          </span>
          <button
            className="btn primary"
            onClick={add}
            disabled={!draft.code.trim() || !draft.name.trim()}
          >שמור</button>
        </div>
      )}

      <ul className="item-list">
        {rows.map((w) => (
          <li key={w.id} className="item-row">
            {editing === w.id ? (
              <>
                <div className="crud-form inline">
                  <input value={edit.code} onChange={(e) => setEdit({ ...edit, code: e.target.value })} />
                  <input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
                  <input value={edit.initials} onChange={(e) => setEdit({ ...edit, initials: e.target.value })} />
                  <select value={edit.color} onChange={(e) => setEdit({ ...edit, color: e.target.value })}>
                    {COLORS.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div className="row-actions">
                  <button className="btn primary sm" onClick={() => save(w.id)} disabled={!edit.name.trim()}>שמור</button>
                  <button className="btn ghost sm" onClick={() => setEditing(null)}>ביטול</button>
                </div>
              </>
            ) : (
              <>
                <div>
                  <span className="avatar-sm" style={{ background: w.color }}>{w.initials}</span>
                  {' '}
                  <strong>{w.name}</strong>
                  <div className="text-muted">{w.code}</div>
                </div>
                <div className={w.active ? '' : 'stock-out'}>
                  {w.active ? 'פעיל' : 'לא פעיל'}
                </div>
                <div className="row-actions">
                  <button className="btn ghost sm" onClick={() => startEdit(w)}>ערוך</button>
                  <button className="btn ghost sm" onClick={() => toggleActive(w)}>
                    {w.active ? 'השבת' : 'הפעל'}
                  </button>
                  <button className="btn ghost sm danger" onClick={() => remove(w)}>מחק</button>
                </div>
              </>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
