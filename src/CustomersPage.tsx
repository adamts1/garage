import { useCallback, useEffect, useState } from 'react';
import {
  createCustomer, deleteCustomer, listCustomers, subscribeToTable, updateCustomer, type Customer,
} from './lib/db';

type Draft = Omit<Customer, 'id'>;

const blank: Draft = { name: '', phone: '', email: '', address: '', city: '', kind: 'פרטי' };

export default function CustomersPage() {
  const [rows, setRows] = useState<Customer[]>([]);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Draft>(blank);
  const [editing, setEditing] = useState<string | null>(null);
  const [edit, setEdit] = useState<Draft>(blank);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
    listCustomers().then(setRows).catch((e) => setErr(e.message));
  }, []);

  useEffect(() => {
    load();
    return subscribeToTable('customers', load);   // another tab adds a customer -> it shows up here
  }, [load]);

  const add = async () => {
    if (!draft.name.trim()) return;
    try {
      await createCustomer(draft);
      setDraft(blank);
      setAdding(false);
      load();
    } catch (e: any) { setErr(e.message); }
  };

  const save = async (id: string) => {
    try {
      await updateCustomer(id, edit);
      setEditing(null);
      load();
    } catch (e: any) { setErr(e.message); }
  };

  const remove = async (c: Customer) => {
    if (!confirm(`למחוק את ${c.name}?`)) return;
    try {
      await deleteCustomer(c.id);
      load();
    } catch (e: any) { setErr(e.message); }
  };

  const startEdit = (c: Customer) => {
    setEditing(c.id);
    setEdit({
      name: c.name, phone: c.phone ?? '', email: c.email ?? '',
      address: c.address ?? '', city: c.city ?? '', kind: c.kind,
    });
  };

  return (
    <>
      <div className="panel-header">
        <h2>רשימת לקוחות <span className="count-pill">{rows.length}</span></h2>
        <button className="btn primary" onClick={() => setAdding((v) => !v)}>
          {adding ? 'ביטול' : 'הוסף לקוח'}
        </button>
      </div>

      {err && <div className="db-error">{err}</div>}

      {adding && (
        <div className="crud-form">
          <input placeholder="שם" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} autoFocus />
          <input placeholder="טלפון" value={draft.phone ?? ''} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} />
          <input placeholder="דוא״ל" value={draft.email ?? ''} onChange={(e) => setDraft({ ...draft, email: e.target.value })} />
          <input placeholder="עיר" value={draft.city ?? ''} onChange={(e) => setDraft({ ...draft, city: e.target.value })} />
          <select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value })}>
            <option>פרטי</option>
            <option>עסקי</option>
          </select>
          <button className="btn primary" onClick={add} disabled={!draft.name.trim()}>שמור</button>
        </div>
      )}

      <section className="card rep-table-card">
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>שם</th>
                <th>טלפון</th>
                <th>דוא״ל</th>
                <th>עיר</th>
                <th>סוג</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                editing === c.id ? (
                  <tr key={c.id}>
                    <td><input className="cell-input wide" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></td>
                    <td><input className="cell-input wide" value={edit.phone ?? ''} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} /></td>
                    <td><input className="cell-input wide" value={edit.email ?? ''} onChange={(e) => setEdit({ ...edit, email: e.target.value })} /></td>
                    <td><input className="cell-input wide" value={edit.city ?? ''} onChange={(e) => setEdit({ ...edit, city: e.target.value })} /></td>
                    <td>
                      <select className="cell-input" value={edit.kind} onChange={(e) => setEdit({ ...edit, kind: e.target.value })}>
                        <option>פרטי</option>
                        <option>עסקי</option>
                      </select>
                    </td>
                    <td className="row-actions">
                      <button className="btn primary sm" onClick={() => save(c.id)}>שמור</button>
                      <button className="btn ghost sm" onClick={() => setEditing(null)}>ביטול</button>
                    </td>
                  </tr>
                ) : (
                  <tr key={c.id}>
                    <td><strong>{c.name}</strong></td>
                    <td>{c.phone || '-'}</td>
                    <td>{c.email || '-'}</td>
                    <td>{c.city || '-'}</td>
                    <td><span className="status-pill">{c.kind}</span></td>
                    <td className="row-actions">
                      <button className="btn ghost sm" onClick={() => startEdit(c)}>ערוך</button>
                      <button className="btn ghost sm danger" onClick={() => remove(c)}>מחק</button>
                    </td>
                  </tr>
                )
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={6} className="empty-note">לא נמצאו לקוחות</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
