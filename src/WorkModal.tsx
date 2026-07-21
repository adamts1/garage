import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import ItemModal from './ItemModal';
import type { PartDef, PartRow, WorkDef } from '@garage/shared';

const shekel = (n: number) => '₪' + n.toLocaleString('he-IL');
const norm = (s: string) => s.trim().toLowerCase();

interface Props {
  catalog: WorkDef[];
  parts: PartDef[];
  addToParts: (part: PartDef) => void;
  initialQuery?: string;
  onPick: (def: WorkDef) => void;      // existing work chosen
  onCreate: (def: WorkDef) => void;    // brand-new work defined
  onClose: () => void;
}

export default function WorkModal({ catalog, parts, addToParts, initialQuery = '', onPick, onCreate, onClose }: Props) {
  const [mode, setMode] = useState<'search' | 'create'>('search');
  const [query, setQuery] = useState(initialQuery);
  const [cursor, setCursor] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);

  // new-work form
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [items, setItems] = useState<PartRow[]>([]);
  const [pickingItem, setPickingItem] = useState(false);

  useEffect(() => { searchRef.current?.focus(); }, []);

  const results = useMemo(() => {
    const q = norm(query);
    if (!q) return catalog;
    return catalog.filter((d) => norm(d.code).includes(q) || norm(d.name).includes(q));
  }, [catalog, query]);

  /** No match + Enter → switch to the create form, carrying what was typed. */
  const startCreate = () => {
    const typed = query.trim();
    const looksLikeCode = /^[A-Za-z0-9\-_]+$/.test(typed);
    setCode(looksLikeCode ? typed.toUpperCase() : '');
    setName(looksLikeCode ? '' : typed);
    setPrice('');
    setItems([]);
    setMode('create');
  };

  const onSearchKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { onClose(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(c + 1, results.length - 1)); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); return; }
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (results.length > 0) onPick(results[cursor] ?? results[0]);
    else startCreate();                    // nothing matched → create a new work
  };

  const attachItem = (part: PartDef) => {
    if (items.some((i) => i.sku === part.sku)) return;
    setItems([...items, { ...part, qty: 1 }]);
    setPickingItem(false);
  };

  const createAndAttachItem = (part: PartDef) => {
    addToParts(part);          // new part joins the parts catalog
    attachItem(part);
  };

  const submitCreate = () => {
    if (!name.trim()) return;
    const def: WorkDef = {
      id: `custom-${Date.now()}`,
      code: (code.trim() || name.trim().slice(0, 6)).toUpperCase(),
      name: name.trim(),
      labor: Number(price) || 0,
      hours: 0,
      items,
    };
    onCreate(def);   // added to the catalog + the ticket; the modal closes
  };

  return createPortal(
    <div className="modal-scrim" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true">
        {mode === 'search' ? (
          <>
            <header className="modal-head">
              <h3>בחר עבודה</h3>
              <button type="button" className="drawer-x" onClick={onClose}>✕</button>
            </header>

            <input
              ref={searchRef}
              className="modal-search"
              placeholder="הקלד קוד או שם עבודה…"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setCursor(0); }}
              onKeyDown={onSearchKey}
            />

            <div className="modal-list">
              {results.map((d, i) => (
                <button
                  type="button"
                  key={d.id}
                  className={`modal-row${i === cursor ? ' on' : ''}`}
                  onMouseEnter={() => setCursor(i)}
                  onClick={() => onPick(d)}
                >
                  <span className="mr-code">{d.code}</span>
                  <span className="mr-name">
                    {d.name}
                    {d.id.startsWith('custom-') && <span className="badge-new">חדשה</span>}
                  </span>
                  <span className="mr-items">{d.items.length ? `${d.items.length} חלקים` : 'ללא חלקים'}</span>
                  <span className="mr-price">{shekel(d.labor)}</span>
                </button>
              ))}

              {results.length === 0 && (
                <div className="modal-empty">
                  <div>לא נמצאה עבודה בשם <b>"{query}"</b></div>
                  <div className="muted">לחץ Enter כדי ליצור עבודה חדשה</div>
                </div>
              )}
            </div>

            <footer className="modal-foot">
              <span className="muted">↑↓ ניווט · Enter בחירה · Esc סגירה</span>
              <button type="button" className="btn primary" onClick={startCreate}>＋ עבודה חדשה</button>
            </footer>
          </>
        ) : (
          <div className="modal-form" onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); submitCreate(); }
            if (e.key === 'Escape') onClose();
          }}>
            <header className="modal-head">
              <h3>עבודה חדשה</h3>
              <button type="button" className="drawer-x" onClick={onClose}>✕</button>
            </header>

            <div className="modal-body">
              <div className="form-row">
                <div className="form-group">
                  <label>קוד</label>
                  <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="לדוגמה: EXH-01" />
                </div>
                <div className="form-group" style={{ flex: 2 }}>
                  <label>שם העבודה *</label>
                  <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
                </div>
                <div className="form-group">
                  <label>מחיר</label>
                  <input type="number" min={0} value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0" />
                </div>
              </div>

              <h4 className="section-title">חלקים לעבודה</h4>
              {items.length === 0 && <p className="empty-note">לא נוספו חלקים - עבודה בלבד.</p>}
              {items.length > 0 && (
                <table className="works-table">
                  <thead>
                    <tr><th>מק״ט</th><th>פריט</th><th style={{ width: 90 }}>כמות</th><th style={{ width: 110 }}>מחיר</th><th style={{ width: 40 }} /></tr>
                  </thead>
                  <tbody>
                    {items.map((i) => (
                      <tr key={i.sku}>
                        <td className="muted-cell">{i.sku}</td>
                        <td>{i.name}</td>
                        <td>
                          <input
                            type="number" className="cell-input" min={1} value={i.qty}
                            onChange={(e) => setItems(items.map((x) => x.sku === i.sku ? { ...x, qty: Number(e.target.value) || 0 } : x))}
                          />
                        </td>
                        <td>
                          <input
                            type="number" className="cell-input" min={0} value={i.price}
                            onChange={(e) => setItems(items.map((x) => x.sku === i.sku ? { ...x, price: Number(e.target.value) || 0 } : x))}
                          />
                        </td>
                        <td>
                          <button type="button" className="row-x" onClick={() => setItems(items.filter((x) => x.sku !== i.sku))}>✕</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              <button type="button" className="add-part-row" onClick={() => setPickingItem(true)}>
                ＋ הוסף חלק - הקלד מק״ט או שם…
              </button>
            </div>

            <footer className="modal-foot">
              <button type="button" className="btn ghost" onClick={() => setMode('search')}>→ חזרה לחיפוש</button>
              <button type="button" className="btn primary" disabled={!name.trim()} onClick={submitCreate}>צור והוסף לכרטיס</button>
            </footer>

            {pickingItem && (
              <ItemModal
                catalog={parts}
                taken={items.map((i) => i.sku)}
                onPick={attachItem}
                onCreate={createAndAttachItem}
                onClose={() => setPickingItem(false)}
              />
            )}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
