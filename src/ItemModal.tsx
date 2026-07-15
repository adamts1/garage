import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { PartDef } from './catalog';

const shekel = (n: number) => '₪' + n.toLocaleString('he-IL');
const norm = (s: string) => s.trim().toLowerCase();

interface Props {
  catalog: PartDef[];
  taken?: string[];                 // SKUs already on the work - hidden from the list
  initialQuery?: string;
  onPick: (part: PartDef) => void;  // existing part chosen
  onCreate: (part: PartDef) => void;// brand-new part defined
  onClose: () => void;
}

export default function ItemModal({ catalog, taken = [], initialQuery = '', onPick, onCreate, onClose }: Props) {
  const [mode, setMode] = useState<'search' | 'create'>('search');
  const [query, setQuery] = useState(initialQuery);
  const [cursor, setCursor] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);

  // new-part form
  const [sku, setSku] = useState('');
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');

  useEffect(() => { searchRef.current?.focus(); }, []);

  const results = useMemo(() => {
    const pool = catalog.filter((p) => !taken.includes(p.sku));
    const q = norm(query);
    if (!q) return pool;
    return pool.filter((p) => norm(p.sku).includes(q) || norm(p.name).includes(q));
  }, [catalog, taken, query]);

  /** No match + Enter → create form, carrying what was typed. */
  const startCreate = () => {
    const typed = query.trim();
    const looksLikeSku = /^[A-Za-z0-9\-_]+$/.test(typed);
    setSku(looksLikeSku ? typed.toUpperCase() : '');
    setName(looksLikeSku ? '' : typed);
    setPrice('');
    setMode('create');
  };

  const onSearchKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { onClose(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(c + 1, results.length - 1)); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); return; }
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (results.length > 0) onPick(results[cursor] ?? results[0]);
    else startCreate();
  };

  const submitCreate = () => {
    if (!name.trim()) return;
    const part: PartDef = {
      sku: (sku.trim() || name.trim().slice(0, 6)).toUpperCase(),
      name: name.trim(),
      price: Number(price) || 0,
    };
    onCreate(part);   // added to the parts catalog + the work; the modal closes
  };

  return createPortal(
    <div className="modal-scrim nested" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true">
        {mode === 'search' ? (
          <>
            <header className="modal-head">
              <h3>הוסף חלק</h3>
              <button type="button" className="drawer-x" onClick={onClose}>✕</button>
            </header>

            <input
              ref={searchRef}
              className="modal-search"
              placeholder="הקלד מק״ט או שם חלק…"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setCursor(0); }}
              onKeyDown={onSearchKey}
            />

            <div className="modal-list">
              {results.map((p, i) => (
                <button
                  type="button"
                  key={p.sku}
                  className={`modal-row${i === cursor ? ' on' : ''}`}
                  onMouseEnter={() => setCursor(i)}
                  onClick={() => onPick(p)}
                >
                  <span className="mr-code">{p.sku}</span>
                  <span className="mr-name">{p.name}</span>
                  <span className="mr-items" />
                  <span className="mr-price">{shekel(p.price)}</span>
                </button>
              ))}

              {results.length === 0 && (
                <div className="modal-empty">
                  <div>לא נמצא חלק בשם <b>"{query}"</b></div>
                  <div className="muted">לחץ Enter כדי ליצור חלק חדש</div>
                </div>
              )}
            </div>

            <footer className="modal-foot">
              <span className="muted">↑↓ ניווט · Enter בחירה · Esc סגירה</span>
              <button type="button" className="btn primary" onClick={startCreate}>＋ חלק חדש</button>
            </footer>
          </>
        ) : (
          <div className="modal-form" onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); submitCreate(); }
            if (e.key === 'Escape') onClose();
          }}>
            <header className="modal-head">
              <h3>חלק חדש</h3>
              <button type="button" className="drawer-x" onClick={onClose}>✕</button>
            </header>

            <div className="modal-body">
              <div className="form-row">
                <div className="form-group">
                  <label>מק״ט</label>
                  <input value={sku} onChange={(e) => setSku(e.target.value)} placeholder="לדוגמה: EXH-22" />
                </div>
                <div className="form-group" style={{ flex: 2 }}>
                  <label>שם החלק *</label>
                  <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
                </div>
                <div className="form-group">
                  <label>מחיר ליח׳</label>
                  <input type="number" min={0} value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0" />
                </div>
              </div>
            </div>

            <footer className="modal-foot">
              <button type="button" className="btn ghost" onClick={() => setMode('search')}>→ חזרה לחיפוש</button>
              <button type="button" className="btn primary" disabled={!name.trim()} onClick={submitCreate}>צור והוסף</button>
            </footer>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
