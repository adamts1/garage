import { useCallback, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { workTotal } from './catalog';
import { IconBoard, IconTickets } from './icons';
import {
  COLUMNS, EPICS, PRIORITIES, TEAM, TYPES,
  type Status, type Ticket,
} from './board-data';

interface BoardProps {
  tickets: Ticket[];
  setTickets: Dispatch<SetStateAction<Ticket[]>>;
  onNewTicket: () => void;
  onOpenTicket: (k: string) => void;   // clicking a card opens the full ticket page
}

interface DragState { k: string; x: number; y: number; dx: number; dy: number; w: number; h: number }
interface Hover { col: Status; lane: string; index: number }

const shekel = (n: number) => '₪' + n.toLocaleString('he-IL');

type SortKey = 'k' | 'title' | 'customer' | 'plate' | 'car' | 'who' | 'st' | 'prio' | 'amount';
const PRIO_RANK: Record<string, number> = { urgent: 0, high: 1, med: 2, low: 3 };

const TABLE_COLS: { key: SortKey; label: string }[] = [
  { key: 'k', label: 'מספר' },
  { key: 'title', label: 'תיאור' },
  { key: 'customer', label: 'לקוח' },
  { key: 'plate', label: 'מספר רישוי' },
  { key: 'car', label: 'רכב' },
  { key: 'st', label: 'סטטוס' },
  { key: 'who', label: 'מכונאי' },
  { key: 'amount', label: 'סכום' },
];
export default function Board({ tickets, setTickets, onNewTicket, onOpenTicket }: BoardProps) {
  const [query, setQuery] = useState('');
  const [view, setView] = useState<'board' | 'table'>('board');
  const [sort, setSort] = useState<{ by: SortKey; dir: 1 | -1 }>({ by: 'k', dir: 1 });
  const [who, setWho] = useState<string | null>(null);

  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<{ k: string; dx: number; dy: number; w: number; h: number; x0: number; y0: number; started: boolean } | null>(null);
  const hoverRef = useRef<Hover | null>(null);
  const [hover, setHover] = useState<Hover | null>(null);

  const visible = useMemo(() => tickets.filter((t) => {
    if (who && t.who !== who) return false;
    if (query) {
      const hay = (t.k + t.title + t.plate + t.car + t.customer).toLowerCase();
      if (!hay.includes(query.toLowerCase())) return false;
    }
    return true;
  }), [tickets, who, query]);

  /* ---------- drag & drop (pointer events: mouse + touch) ---------- */
  const commit = useCallback(() => {
    const d = dragRef.current;
    const h = hoverRef.current;
    if (!d || !h) return;

    setTickets((prev) => {
      const moving = prev.find((t) => t.k === d.k);
      if (!moving) return prev;
      const rest = prev.filter((t) => t.k !== d.k);

      const next: Ticket = { ...moving, st: h.col };
      if (h.col !== 'parts') delete next.blocked;          // leaving the blocked column clears the blocker
      if (h.col === 'done' || h.col === 'paid') next.done = next.subtasks.length; // ready/paid ticks everything off
      if (h.col === 'paid') next.paid = true;                 // dragging into "שולם" marks it paid

      // order inside the destination column is the array order
      const siblings = rest.filter((t) => t.st === h.col);
      const anchor = siblings[h.index];
      const at = anchor
        ? rest.indexOf(anchor)
        : siblings.length
          ? rest.indexOf(siblings[siblings.length - 1]) + 1
          : rest.length;

      const out = [...rest];
      out.splice(at, 0, next);
      return out;
    });
  }, [setTickets]);

  const onMove = useCallback((e: PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;

    if (!d.started) {
      if (Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 5) return; // taps stay taps
      d.started = true;
      document.body.classList.add('is-dragging');
    }
    e.preventDefault();
    setDrag({ k: d.k, x: e.clientX, y: e.clientY, dx: d.dx, dy: d.dy, w: d.w, h: d.h });

    const under = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
    const list = under?.closest('.jb-list') as HTMLElement | null;
    if (!list) { hoverRef.current = null; setHover(null); return; }

    const cards = Array.from(list.querySelectorAll<HTMLElement>('.tkt'))
      .filter((c) => c.dataset.k !== d.k);
    let index = cards.length;
    for (let i = 0; i < cards.length; i++) {
      const r = cards[i].getBoundingClientRect();
      if (e.clientY < r.top + r.height / 2) { index = i; break; }
    }
    const next: Hover = { col: list.dataset.col as Status, lane: list.dataset.lane || 'all', index };
    hoverRef.current = next;
    setHover(next);

    // auto-scroll the column vertically and the board horizontally near the edges
    const lr = list.getBoundingClientRect();
    if (e.clientY < lr.top + 44) list.scrollTop -= 12;
    else if (e.clientY > lr.bottom - 44) list.scrollTop += 12;
    const board = list.closest('.jb-board') as HTMLElement | null;
    if (board) {
      const br = board.getBoundingClientRect();
      if (e.clientX < br.left + 48) board.scrollLeft -= 16;
      else if (e.clientX > br.right - 48) board.scrollLeft += 16;
    }
  }, []);

  const onUp = useCallback(() => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    document.body.classList.remove('is-dragging');

    const d = dragRef.current;
    if (d?.started) commit();
    else if (d) onOpenTicket(d.k); // never moved → it was a click, open the ticket page

    dragRef.current = null;
    hoverRef.current = null;
    setDrag(null);
    setHover(null);
  }, [commit, onMove, onOpenTicket]);

  const onDown = useCallback((e: React.PointerEvent<HTMLDivElement>, t: Ticket) => {
    if (e.button !== 0) return;
    const r = e.currentTarget.getBoundingClientRect();
    dragRef.current = {
      k: t.k, dx: e.clientX - r.left, dy: e.clientY - r.top,
      w: r.width, h: r.height, x0: e.clientX, y0: e.clientY, started: false,
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }, [onMove, onUp]);

  const rows = useMemo(() => {
    const val = (t: Ticket, key: SortKey) => {
      if (key === 'st') return COLUMNS.findIndex((c) => c.id === t.st);
      if (key === 'prio') return PRIO_RANK[t.prio];
      if (key === 'who') return TEAM[t.who].n;
      if (key === 'amount') return t.amount;
      return String(t[key] ?? '');
    };
    return [...visible].sort((a, b) => {
      const x = val(a, sort.by);
      const y = val(b, sort.by);
      if (x === y) return 0;
      return (x > y ? 1 : -1) * sort.dir;
    });
  }, [visible, sort]);

  const toggleSort = (by: SortKey) =>
    setSort((p) => (p.by === by ? { by, dir: p.dir === 1 ? -1 : 1 } : { by, dir: 1 }));

  /* ---------- rendering ---------- */
  const card = (t: Ticket) => (
    <div
      key={t.k}
      className={`tkt${drag?.k === t.k ? ' is-hidden' : ''}`}
      data-k={t.k}
      onPointerDown={(e) => onDown(e, t)}
    >
      <span className="plate">{t.plate}</span>
      <div className="tkt-title">{t.title}</div>
      <div className="tkt-car">{t.car}</div>
    </div>
  );

  const columns = (list: Ticket[], lane: string) => (
    <div className="jb-board">
      {COLUMNS.map((col) => {
        const items = list.filter((t) => t.st === col.id);
        const over = !!col.wip && items.length > col.wip;
        const dropping = hover?.col === col.id && hover.lane === lane;
        const slot = <div key="slot" className="drop-slot" style={{ height: drag ? drag.h : 0 }} />;
        const rendered: React.ReactNode[] = items.map(card);
        if (dropping && drag) rendered.splice(hover.index, 0, slot);
        return (
          <section key={col.id} className={`jb-col${over ? ' wip-over' : ''}`}>
            <header className="jb-col-head">
              <span className="jb-dot" style={{ background: col.dot }} />
              {col.title}
              {over && <span className="jb-wip">חריגת WIP</span>}
              <span className="jb-count">{items.length}{col.wip ? `/${col.wip}` : ''}</span>
            </header>
            <div className={`jb-list${dropping ? ' is-target' : ''}`} data-col={col.id} data-lane={lane}>
              {rendered}
            </div>
          </section>
        );
      })}
    </div>
  );

  const ghost = drag ? tickets.find((t) => t.k === drag.k) : null;

  return (
    <div className="jb">
      <div className="jb-bar">
        <div className="avatar-stack">
          <button className={`avatar-sm all${!who ? ' on' : ''}`} onClick={() => setWho(null)} title="הכל">👥</button>
          {Object.entries(TEAM).map(([id, m]) => (
            <button
              key={id}
              className={`avatar-sm${who === id ? ' on' : ''}`}
              style={{ background: m.bg }}
              title={m.n}
              onClick={() => setWho(who === id ? null : id)}
            >{m.ini}</button>
          ))}
        </div>

        <div className="jb-spacer" />

        <div className="view-toggle">
          <button
            className={view === 'board' ? 'on' : ''}
            onClick={() => setView('board')}
            title="תצוגת לוח"
          ><IconBoard /> לוח</button>
          <button
            className={view === 'table' ? 'on' : ''}
            onClick={() => setView('table')}
            title="תצוגת טבלה"
          ><IconTickets /> טבלה</button>
        </div>

        <button className="btn primary" onClick={onNewTicket}>הוסף כרטיס ＋</button>
      </div>

      <div className="jb-filters">
        <input
          className="jb-search"
          placeholder="חיפוש טיקט / רכב / לקוח"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="jb-spacer" />
        <span className="jb-shown">{visible.length} מתוך {tickets.length}</span>
      </div>

      {view === 'board' ? columns(visible, 'all') : (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                {TABLE_COLS.map((c) => (
                  <th
                    key={c.key}
                    onClick={() => toggleSort(c.key)}
                    className={sort.by === c.key ? 'sorted' : ''}
                  >
                    {c.label}
                    <span className="sort-ar">{sort.by === c.key ? (sort.dir === 1 ? '▲' : '▼') : ''}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => {
                const col = COLUMNS.find((c) => c.id === t.st);
                const m = TEAM[t.who];
                const e = EPICS[t.epic];
                return (
                  <tr key={t.k} onClick={() => onOpenTicket(t.k)}>
                    <td className="tbl-key">{t.k}</td>
                    <td>
                      <div className="tbl-title">{t.title}</div>
                      <span className="epic" style={{ background: e.bg, color: e.c }}>{e.t}</span>
                      {t.blocked && <span className="tbl-blocked">⛔ חסום</span>}
                    </td>
                    <td>{t.customer}</td>
                    <td><span className="plate">{t.plate}</span></td>
                    <td>{t.car}</td>
                    <td>
                      <span className="st-pill">
                        <span className="prio-dot" style={{ background: col?.dot }} /> {col?.title}
                      </span>
                    </td>
                    <td>
                      <span className="avatar-sm" style={{ background: m.bg }}>{m.ini}</span>
                    </td>
                    <td className="tbl-amount">{t.amount ? shekel(t.amount) : '-'}</td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr><td colSpan={TABLE_COLS.length} className="empty-note">לא נמצאו כרטיסים</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* card that follows the pointer while dragging */}
      {drag && ghost && (
        <div
          className="tkt tkt-ghost"
          style={{ left: drag.x - drag.dx, top: drag.y - drag.dy, width: drag.w }}
        >
          <span className="plate">{ghost.plate}</span>
          <div className="tkt-title">{ghost.title}</div>
          <div className="tkt-car">{ghost.car}</div>
        </div>
      )}

    </div>
  );
}
