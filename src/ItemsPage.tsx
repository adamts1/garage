import { useCallback, useEffect, useState } from 'react';
import { createItem, deleteItem, listItems, subscribeToTable, updateItem, type Item } from './lib/db';

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

  return (
    <>
      <div className="panel-header">
        <h2>פריטי מלאי <span className="count-pill">{rows.length}</span></h2>
        <button className="btn primary" onClick={() => setAdding((v) => !v)}>
          {adding ? 'ביטול' : 'הוסף פריט'}
        </button>
      </div>

      {err && <div className="db-error">{err}</div>}

      {adding && (
        <div className="crud-form">
          <input placeholder="מק״ט" value={draft.sku} onChange={(e) => setDraft({ ...draft, sku: e.target.value })} autoFocus />
          <input placeholder="שם הפריט" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          <input type="number" placeholder="מחיר" value={draft.price} onChange={(e) => setDraft({ ...draft, price: Number(e.target.value) })} />
          <input type="number" placeholder="מלאי" value={draft.stock} onChange={(e) => setDraft({ ...draft, stock: Number(e.target.value) })} />
          <button className="btn primary" onClick={add} disabled={!draft.sku.trim() || !draft.name.trim()}>שמור</button>
        </div>
      )}

      <ul className="item-list">
        {rows.map((i) => (
          <li key={i.id} className="item-row">
            {editing === i.id ? (
              <>
                <div className="crud-form inline">
                  <input value={edit.sku} onChange={(e) => setEdit({ ...edit, sku: e.target.value })} />
                  <input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
                  <input type="number" value={edit.price} onChange={(e) => setEdit({ ...edit, price: Number(e.target.value) })} />
                  <input type="number" value={edit.stock} onChange={(e) => setEdit({ ...edit, stock: Number(e.target.value) })} />
                </div>
                <div className="row-actions">
                  <button className="btn primary sm" onClick={() => save(i.id)}>שמור</button>
                  <button className="btn ghost sm" onClick={() => setEditing(null)}>ביטול</button>
                </div>
              </>
            ) : (
              <>
                <div>
                  <strong>{i.name}</strong>
                  <div className="text-muted">{i.sku} · {shekel(i.price)}</div>
                </div>
                <div className={i.stock === 0 ? 'stock-out' : ''}>
                  {i.stock === 0 ? 'אזל מהמלאי' : `${i.stock} במלאי`}
                </div>
                <div className="row-actions">
                  <button className="btn ghost sm" onClick={() => startEdit(i)}>ערוך</button>
                  <button className="btn ghost sm danger" onClick={() => remove(i)}>מחק</button>
                </div>
              </>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
