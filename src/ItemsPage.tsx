import { useCallback, useEffect, useMemo, useState } from 'react';
import { createItem, deleteItem, listItems, subscribeToTable, updateItem, type Item } from '@garage/shared';

type Draft = Omit<Item, 'id'>;

const blank: Draft = { sku: '', name: '', price: 0, stock: 0 };

const shekel = (n: number) => '₪' + n.toLocaleString('he-IL');

export default function ItemsPage() {
  const [rows, setRows] = useState<Item[]>([]);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Draft>(blank);
  const [editing, setEditing] = useState<string | null>(null);
  const [edit, setEdit] = useState<Draft>(blank);
  const [err, setErr] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const load = useCallback(() => {
    listItems().then(setRows).catch((e) => setErr(e.message));
  }, []);

  useEffect(() => {
    load();
    return subscribeToTable('items', load);
  }, [load]);

  const add = async () => {
    if (!draft.sku.trim() || !draft.name.trim()) return;
    try {
      await createItem(draft);
      setDraft(blank);
      setAdding(false);
      load();
    } catch (e: any) { setErr(e.message); }
  };

  const save = async (id: string) => {
    try {
      await updateItem(id, edit);
      setEditing(null);
      load();
    } catch (e: any) { setErr(e.message); }
  };

  const remove = async (i: Item) => {
    if (!confirm(`למחוק את ${i.name}?`)) return;
    try {
      await deleteItem(i.id);
      load();
    } catch (e: any) { setErr(e.message); }
  };

  const startEdit = (i: Item) => {
    setEditing(i.id);
    setEdit({ sku: i.sku, name: i.name, price: i.price, stock: i.stock });
  };

  /* Search covers מק״ט and name — the two things anyone knows about a part when
     they come looking for it. A garage's list runs to hundreds of rows, and
     scrolling was the only way to find one. */
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((i) => i.sku.toLowerCase().includes(q) || i.name.toLowerCase().includes(q));
  }, [rows, query]);

  return (
    <>
      <div className="panel-header">
        <h2>פריטי מלאי <span className="count-pill">{rows.length}</span></h2>
        <button className="btn primary" onClick={() => setAdding((v) => !v)}>
          {adding ? 'ביטול' : 'הוסף פריט'}
        </button>
      </div>

      {err && <div className="db-error">{err}</div>}

      <div className="items-filters">
        <input
          className="jb-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="חיפוש לפי מק״ט או שם פריט"
        />
        {query.trim() && (
          <button className="btn ghost" onClick={() => setQuery('')}>איפוס</button>
        )}
      </div>

      {adding && (
        <div className="crud-form">
          <input placeholder="מק״ט" value={draft.sku} onChange={(e) => setDraft({ ...draft, sku: e.target.value })} autoFocus />
          <input placeholder="שם הפריט" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          <input type="number" placeholder="מחיר" value={draft.price} onChange={(e) => setDraft({ ...draft, price: Number(e.target.value) })} />
          <input type="number" placeholder="מלאי" value={draft.stock} onChange={(e) => setDraft({ ...draft, stock: Number(e.target.value) })} />
          <button className="btn primary" onClick={add} disabled={!draft.sku.trim() || !draft.name.trim()}>שמור</button>
        </div>
      )}

      {/* One column per field. The old list glued מק״ט and price into a subtitle
          under the name and gave the whole row over to a stock badge, so nothing
          lined up and no column could be scanned down. */}
      <section className="card">
        <table className="works-table items-table">
          <thead>
            <tr>
              <th style={{ width: 140 }}>מק״ט</th>
              <th>שם הפריט</th>
              <th style={{ width: 120 }}>מחיר</th>
              <th style={{ width: 90 }}>מלאי</th>
              <th style={{ width: 150 }} />
            </tr>
          </thead>
          <tbody>
            {shown.map((i) => (
              <tr key={i.id}>
                {editing === i.id ? (
                  <>
                    <td><input className="cell-input" value={edit.sku} onChange={(e) => setEdit({ ...edit, sku: e.target.value })} /></td>
                    <td><input className="cell-input wide" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></td>
                    <td><input className="cell-input" type="number" min={0} value={edit.price} onChange={(e) => setEdit({ ...edit, price: Number(e.target.value) })} /></td>
                    <td><input className="cell-input" type="number" min={0} value={edit.stock} onChange={(e) => setEdit({ ...edit, stock: Number(e.target.value) })} /></td>
                    <td>
                      <div className="row-actions">
                        <button className="btn primary sm" onClick={() => save(i.id)}>שמור</button>
                        <button className="btn ghost sm" onClick={() => setEditing(null)}>ביטול</button>
                      </div>
                    </td>
                  </>
                ) : (
                  <>
                    <td className="muted-cell">{i.sku}</td>
                    <td><strong>{i.name}</strong></td>
                    <td>{shekel(i.price)}</td>
                    <td className="muted-cell">{i.stock}</td>
                    <td>
                      <div className="row-actions">
                        <button className="btn ghost sm" onClick={() => startEdit(i)}>ערוך</button>
                        <button className="btn ghost sm danger" onClick={() => remove(i)}>מחק</button>
                      </div>
                    </td>
                  </>
                )}
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={5} className="empty-note">
                  {rows.length ? `לא נמצא פריט התואם ל"${query.trim()}"` : 'אין פריטים'}
                </td>
              </tr>
            )}
          </tbody>
          {query.trim() && (
            <tfoot>
              <tr><td colSpan={5} className="muted-cell">{shown.length} מתוך {rows.length} פריטים</td></tr>
            </tfoot>
          )}
        </table>
      </section>
    </>
  );
}
