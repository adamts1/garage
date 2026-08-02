import type { Status, Ticket } from '@garage/shared';
import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from 'react';

export interface DragState {
  k: string;
  x: number;
  y: number;
  dx: number;
  dy: number;
  w: number;
  h: number;
}

export interface DropTarget {
  col: Status;
  lane: string;
  index: number;
}

/* The drag code finds its targets through data attributes rather than class
   names. Class names are hashed by CSS modules, so `closest('.jb-list')` would
   have quietly stopped matching anything the moment the styles moved into a
   module — the board would render perfectly and simply refuse to accept a drop.
   These attributes are part of the contract; the classes are decoration. */
export const DROP_LIST_ATTR = 'data-drop-list';
export const CARD_ATTR = 'data-ticket-card';
export const BOARD_ATTR = 'data-board';

/** Below this a pointer-down is a click, not a drag, so tapping a card still
 *  opens it. */
const DRAG_THRESHOLD_PX = 5;
/** How close to an edge before the list or the board scrolls itself. */
const EDGE_PX = 44;
const BOARD_EDGE_PX = 48;

/**
 * Moves a ticket between columns. Where it lands is decided from the DOM under
 * the pointer, which is why this reads the document directly rather than
 * tracking rectangles in state.
 */
export function useBoardDrag({
  setTickets,
  onOpenTicket,
}: {
  setTickets: Dispatch<SetStateAction<Ticket[]>>;
  onOpenTicket: (k: string) => void;
}) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const [hover, setHover] = useState<DropTarget | null>(null);

  const dragRef = useRef<
    { k: string; dx: number; dy: number; w: number; h: number; x0: number; y0: number; started: boolean } | null
  >(null);
  const hoverRef = useRef<DropTarget | null>(null);

  const commit = useCallback(() => {
    const d = dragRef.current;
    const h = hoverRef.current;
    if (!d || !h) return;

    setTickets((prev) => {
      const moving = prev.find((t) => t.k === d.k);
      if (!moving) return prev;
      const rest = prev.filter((t) => t.k !== d.k);

      const next: Ticket = { ...moving, st: h.col };
      // Leaving the blocked column clears the blocker.
      if (h.col !== 'parts') delete next.blocked;
      // Ready or paid ticks everything off.
      if (h.col === 'done' || h.col === 'paid') next.done = next.subtasks.length;
      if (h.col === 'paid') next.paid = true;

      // Order inside the destination column is the array order.
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
      if (Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < DRAG_THRESHOLD_PX) return;
      d.started = true;
      document.body.classList.add('is-dragging');
    }
    e.preventDefault();
    setDrag({ k: d.k, x: e.clientX, y: e.clientY, dx: d.dx, dy: d.dy, w: d.w, h: d.h });

    const under = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
    const list = under?.closest<HTMLElement>(`[${DROP_LIST_ATTR}]`);
    if (!list) {
      hoverRef.current = null;
      setHover(null);
      return;
    }

    const cards = Array.from(list.querySelectorAll<HTMLElement>(`[${CARD_ATTR}]`))
      .filter((c) => c.dataset.k !== d.k);
    let index = cards.length;
    for (let i = 0; i < cards.length; i += 1) {
      const r = cards[i].getBoundingClientRect();
      if (e.clientY < r.top + r.height / 2) {
        index = i;
        break;
      }
    }

    const next: DropTarget = {
      col: list.dataset.col as Status,
      lane: list.dataset.lane || 'all',
      index,
    };
    hoverRef.current = next;
    setHover(next);

    // Auto-scroll the column vertically and the board horizontally near an edge.
    const lr = list.getBoundingClientRect();
    if (e.clientY < lr.top + EDGE_PX) list.scrollTop -= 12;
    else if (e.clientY > lr.bottom - EDGE_PX) list.scrollTop += 12;

    const board = list.closest<HTMLElement>(`[${BOARD_ATTR}]`);
    if (board) {
      const br = board.getBoundingClientRect();
      if (e.clientX < br.left + BOARD_EDGE_PX) board.scrollLeft -= 16;
      else if (e.clientX > br.right - BOARD_EDGE_PX) board.scrollLeft += 16;
    }
  }, []);

  const onUp = useCallback(() => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    document.body.classList.remove('is-dragging');

    const d = dragRef.current;
    if (d?.started) commit();
    else if (d) onOpenTicket(d.k); // never moved → it was a click

    dragRef.current = null;
    hoverRef.current = null;
    setDrag(null);
    setHover(null);
  }, [commit, onMove, onOpenTicket]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>, ticket: Ticket) => {
      if (e.button !== 0) return;
      const r = e.currentTarget.getBoundingClientRect();
      dragRef.current = {
        k: ticket.k,
        dx: e.clientX - r.left,
        dy: e.clientY - r.top,
        w: r.width,
        h: r.height,
        x0: e.clientX,
        y0: e.clientY,
        started: false,
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    },
    [onMove, onUp],
  );

  return { drag, hover, onPointerDown };
}
