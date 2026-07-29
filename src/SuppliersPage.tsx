import { useCallback, useEffect, useState } from 'react';
import {
  createSupplier, deleteSupplier, listSuppliers, subscribeToExpenses, updateSupplier,
  type Supplier,
} from '@garage/shared';

type Draft = { name: string; taxId: string; phone: string; email: string; address: string; notes: string };
const blank: Draft = { name: '', taxId: '', phone: '', email: '', address: '', notes: '' };
const toDraft = (s: Supplier): Draft => ({
  name: s.name, taxId: s.taxId ?? '', phone: s.phone ?? '',
  email: s.email ?? '', address: s.address ?? '', notes: s.notes ?? '',
});

export default function SuppliersPage() {
  const [rows, setRows] = useState<Supplier[]>([]);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Draft>(blank);
  const [editing, setEditing] = useState<string | null>(null);
  const [edit, setEdit] = useState<Draft>(blank);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
    listSuppliers().then(setRows).catch((e) => setErr(e.message));
  }, []);

  useEffect(() => {
    load();
    return subscribeToExpenses(load);   // suppliers change (here or via a sync) -> refresh
  }, [load]);

  const add = async () => {
    if (!draft.name.trim()) return;
    try {
      await createSupplier(draft);
      setDraft(blank); setAdding(false); load();
    } catch (e: any) { setErr(e.message); }
  };

  const save = async (id: string) => {
    try { await updateSupplier(id, edit); setEditing(null); load(); }
    catch (e: any) { setErr(e.message); }
  };

  const remove = async (s: Supplier) => {
    if (!confirm(`למחוק את הספק ${s.name}?`)) return;
    try { await deleteSupplier(s.id); load(); }
    catch (e: any) { setErr('לא ניתן למחוק ספק עם הוצאות קיימות'); }
  };

  return (
    <>
      <div className="panel-header">
        <h2>ספקים <span className="count-pill">{rows.length}</span></h2>
        <button className="btn primary" onClick={() => setAdding((v) => !v)}>
          {adding ? 'ביטול' : 'הוסף ספק'}
        </button>
      </div>

      {err && <div className="db-error">{err}</div>}

      {adding && (
        <div className="crud-form">
          <input placeholder="שם הספק" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} autoFocus />
          <input placeholder="ח.פ / עוסק מורשה" inputMode="numeric" value={draft.taxId} onChange={(e) => setDraft({ ...draft, taxId: e.target.value })} />
          <input placeholder="טלפון" value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} />
          <input placeholder="דוא״ל" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} />
          <input placeholder="כתובת" value={draft.address} onChange={(e) => setDraft({ ...draft, address: e.target.value })} />
          <button className="btn primary" onClick={add} disabled={!draft.name.trim()}>שמור</button>
        </div>
      )}

      <section className="card rep-table-card">
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr><th>שם</th><th>ח.פ / ע.מ</th><th>טלפון</th><th>דוא״ל</th><th>כתובת</th><th /></tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                editing === s.id ? (
                  <tr key={s.id}>
                    <td><input className="cell-input wide" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></td>
                    <td><input className="cell-input" inputMode="numeric" value={edit.taxId} onChange={(e) => setEdit({ ...edit, taxId: e.target.value })} /></td>
                    <td><input className="cell-input" value={edit.phone} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} /></td>
                    <td><input className="cell-input wide" value={edit.email} onChange={(e) => setEdit({ ...edit, email: e.target.value })} /></td>
                    <td><input className="cell-input wide" value={edit.address} onChange={(e) => setEdit({ ...edit, address: e.target.value })} /></td>
                    <td className="row-actions">
                      <button className="btn primary sm" onClick={() => save(s.id)}>שמור</button>
                      <button className="btn ghost sm" onClick={() => setEditing(null)}>ביטול</button>
                    </td>
                  </tr>
                ) : (
                  <tr key={s.id}>
                    <td><strong>{s.name}</strong></td>
                    <td>{s.taxId || '-'}</td>
                    <td>{s.phone || '-'}</td>
                    <td>{s.email || '-'}</td>
                    <td>{s.address || '-'}</td>
                    <td className="row-actions">
                      <button className="btn ghost sm" onClick={() => { setEditing(s.id); setEdit(toDraft(s)); }}>ערוך</button>
                      <button className="btn ghost sm danger" onClick={() => remove(s)}>מחק</button>
                    </td>
                  </tr>
                )
              ))}
              {rows.length === 0 && <tr><td colSpan={6} className="empty-note">לא נמצאו ספקים</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
