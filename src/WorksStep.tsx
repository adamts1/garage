import { useState } from 'react';
import { IconBox, IconToolbox, IconWrench } from './icons';
import ItemModal from './ItemModal';
import WorkModal from './WorkModal';
import {
  fromCatalog, workTotal,
  type PartDef, type TicketWork, type WorkDef,
} from './catalog';

const shekel = (n: number) => '₪' + n.toLocaleString('he-IL');

interface Props {
  works: TicketWork[];
  setWorks: (next: TicketWork[]) => void;
  catalog: WorkDef[];
  addToCatalog: (def: WorkDef) => void;
  parts: PartDef[];
  addToParts: (part: PartDef) => void;
  combinedEmpty?: boolean;   // one shared empty-state instead of one per column
}

export default function WorksStep({ works, setWorks, catalog, addToCatalog, parts, addToParts, combinedEmpty }: Props) {
  const [selected, setSelected] = useState<string | null>(works[0]?.uid ?? null);
  const [picking, setPicking] = useState(false);
  const [pickingItem, setPickingItem] = useState(false);
  const [typed, setTyped] = useState('');
  const [seq, setSeq] = useState(1);

  const current = works.find((w) => w.uid === selected) ?? null;

  const attach = (def: WorkDef) => {
    const uid = `w${seq}`;
    setSeq(seq + 1);
    setWorks([...works, fromCatalog(def, uid)]);   // brings the work's parts with it
    setSelected(uid);
    setPicking(false);
    setTyped('');
  };

  /** A work invented in the modal joins the catalog, then gets attached like any other. */
  const createAndAttach = (def: WorkDef) => {
    addToCatalog(def);
    attach(def);          // closes the modal → you land on the works table with it selected
  };

  const openPicker = (seed = '') => { setTyped(seed); setPicking(true); };

  const removeWork = (uid: string) => {
    setWorks(works.filter((w) => w.uid !== uid));
    if (selected === uid) setSelected(null);
  };

  const patchWork = (uid: string, patch: Partial<TicketWork>) =>
    setWorks(works.map((w) => (w.uid === uid ? { ...w, ...patch } : w)));

  const patchItem = (uid: string, sku: string, patch: Partial<{ qty: number; price: number }>) =>
    setWorks(works.map((w) => (w.uid === uid
      ? { ...w, items: w.items.map((i) => (i.sku === sku ? { ...i, ...patch } : i)) }
      : w)));

  const removeItem = (uid: string, sku: string) =>
    setWorks(works.map((w) => (w.uid === uid
      ? { ...w, items: w.items.filter((i) => i.sku !== sku) }
      : w)));

  const attachItem = (part: PartDef) => {
    if (!current || current.items.some((i) => i.sku === part.sku)) return;
    patchWork(current.uid, { items: [...current.items, { ...part, qty: 1 }] });
    setPickingItem(false);
  };

  /** A part invented in the modal joins the parts catalog, then gets attached. */
  const createAndAttachItem = (part: PartDef) => {
    addToParts(part);
    attachItem(part);     // closes the modal → you land on the parts table with it added
  };

  if (combinedEmpty && works.length === 0) {
    return (
      <div className="works-step">
        <div className="ws-empty">
          <div className="ws-empty-ic big"><IconToolbox /></div>
          <h4>טרם נוספו עבודות או פריטים</h4>
          <p>הוסף עבודה או פריט כדי להתחיל</p>
          <div className="ws-empty-actions">
            <button type="button" className="btn primary" onClick={() => openPicker('')}>
              הוסף עבודה <span className="plus">＋</span>
            </button>
            <button type="button" className="btn-outline" onClick={() => openPicker('')}>
              הוסף פריט <span className="plus">＋</span>
            </button>
          </div>
        </div>

        {picking && (
          <WorkModal
            catalog={catalog}
            parts={parts}
            addToParts={addToParts}
            initialQuery={typed}
            onPick={attach}
            onCreate={createAndAttach}
            onClose={() => { setPicking(false); setTyped(''); }}
          />
        )}
      </div>
    );
  }

  return (
    <div className="works-step">
      <div className="ws-grid">
      <div className="ws-col">
        <div className="ws-head">
          <span className="ws-title"><IconWrench /> עבודות ({works.length})</span>
          {works.length > 0 && (
            <button type="button" className="btn-mini" onClick={() => openPicker('')}>
              <span className="plus">＋</span> הוסף עבודה
            </button>
          )}
        </div>

        {works.length === 0 ? (
          <div className="ws-empty">
            <div className="ws-empty-ic"><IconWrench size={30} /></div>
            <h4>אין עבודות בכרטיס</h4>
            <p>לחץ על כפתור "הוסף עבודה" כדי להוסיף עבודה חדשה</p>
            <button type="button" className="btn-outline" onClick={() => openPicker('')}>
              הוסף עבודה <span className="plus">＋</span>
            </button>
          </div>
        ) : (
        <>

        <table className="works-table">
          <thead>
            <tr>
              <th style={{ width: 130 }}>קוד</th>
              <th>שם העבודה</th>
              <th style={{ width: 130 }}>מחיר</th>
              <th style={{ width: 90 }}>חלקים</th>
              <th style={{ width: 110 }}>סה״כ</th>
              <th style={{ width: 40 }} />
            </tr>
          </thead>
          <tbody>
            {works.map((w) => (
              <tr
                key={w.uid}
                className={w.uid === selected ? 'is-selected' : ''}
                onClick={() => setSelected(w.uid)}
              >
                <td>
                  <input
                    className="cell-input code"
                    value={w.code}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => patchWork(w.uid, { code: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    className="cell-input wide"
                    value={w.name}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => patchWork(w.uid, { name: e.target.value })}
                  />
                  {w.custom && <span className="badge-new">חדשה</span>}
                </td>
                <td>
                  <input
                    type="number"
                    className="cell-input"
                    value={w.labor}
                    min={0}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => patchWork(w.uid, { labor: Number(e.target.value) || 0 })}
                  />
                </td>
                <td className="muted-cell">{w.items.length}</td>
                <td><strong>{shekel(workTotal(w))}</strong></td>
                <td>
                  <button
                    type="button"
                    className="row-x"
                    onClick={(e) => { e.stopPropagation(); removeWork(w.uid); }}
                    title="הסר עבודה"
                  >✕</button>
                </td>
              </tr>
            ))}

          </tbody>
        </table>
        </>
        )}
      </div>

      <div className="ws-col">
        <div className="ws-head">
          <span className="ws-title">
            <IconBox /> פריטים לעבודה ({current ? current.items.length : 0})
            {current && <span className="of-work">{current.name}</span>}
          </span>
          {current && current.items.length > 0 && (
            <button type="button" className="btn-mini" onClick={() => setPickingItem(true)}>
              <span className="plus">＋</span> הוסף פריט
            </button>
          )}
        </div>

        {!current || current.items.length === 0 ? (
          <div className="ws-empty">
            <div className="ws-empty-ic"><IconBox size={30} /></div>
            <h4>אין פריטים לעבודה</h4>
            <p>בחר עבודה מהרשימה או הוסף עבודה חדשה כדי להוסיף פריטים</p>
            <button
              type="button"
              className="btn-outline"
              onClick={() => (current ? setPickingItem(true) : openPicker(''))}
            >
              הוסף פריט לעבודה <span className="plus">＋</span>
            </button>
          </div>
        ) : (
          <>
          <table className="works-table">
            <thead>
              <tr>
                <th>מק״ט</th>
                <th>פריט</th>
                <th style={{ width: 90 }}>כמות</th>
                <th style={{ width: 110 }}>מחיר ליח׳</th>
                <th style={{ width: 110 }}>סה״כ</th>
                <th style={{ width: 40 }} />
              </tr>
            </thead>
            <tbody>
              {current.items.length === 0 && (
                <tr>
                  <td colSpan={6} className="empty-note">אין חלקים לעבודה זו — עבודה בלבד.</td>
                </tr>
              )}
              {current.items.map((i) => (
                <tr key={i.sku}>
                  <td className="muted-cell">{i.sku}</td>
                  <td>{i.name}</td>
                  <td>
                    <input
                      type="number"
                      className="cell-input"
                      value={i.qty}
                      min={0}
                      onChange={(e) => patchItem(current.uid, i.sku, { qty: Number(e.target.value) || 0 })}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      className="cell-input"
                      value={i.price}
                      min={0}
                      onChange={(e) => patchItem(current.uid, i.sku, { price: Number(e.target.value) || 0 })}
                    />
                  </td>
                  <td><strong>{shekel(i.qty * i.price)}</strong></td>
                  <td>
                    <button type="button" className="row-x" onClick={() => removeItem(current.uid, i.sku)} title="הסר פריט">✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          </>
        )}
      </div>
      </div>

      {picking && (
        <WorkModal
          catalog={catalog}
          parts={parts}
          addToParts={addToParts}
          initialQuery={typed}
          onPick={attach}
          onCreate={createAndAttach}
          onClose={() => { setPicking(false); setTyped(''); }}
        />
      )}

      {pickingItem && current && (
        <ItemModal
          catalog={parts}
          taken={current.items.map((i) => i.sku)}
          onPick={attachItem}
          onCreate={createAndAttachItem}
          onClose={() => setPickingItem(false)}
        />
      )}
    </div>
  );
}
