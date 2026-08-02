// @vitest-environment jsdom
import type { Ticket } from '@garage/shared';
import { act, cleanup, render } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { CARD_ATTR, useBoardDrag } from './useBoardDrag';

beforeAll(() => {
  /* jsdom does no layout, so it has no elementFromPoint — and the drag calls it
     on every move to find the list under the pointer. Left unstubbed it throws
     inside the listener, which vitest reports as an unhandled error: the
     assertions below still hold, but a real failure could hide behind the
     noise. "Nothing under the pointer" is a case the code already handles. */
  document.elementFromPoint = () => null;
});

afterEach(() => {
  cleanup();
  document.body.classList.remove('is-dragging');
});

const ticket = { k: 'GAR-1' } as Ticket;

function Subject({ onOpenTicket = () => {} }: { onOpenTicket?: (k: string) => void }) {
  const { onPointerDown } = useBoardDrag({ setTickets: () => {}, onOpenTicket });
  return (
    <div
      {...{ [CARD_ATTR]: '' }}
      data-testid="card"
      onPointerDown={(e) => onPointerDown(e, ticket)}
    />
  );
}

/** jsdom has no PointerEvent, and the code only reads coordinates and button. */
const pointer = (type: string, x: number, y: number) =>
  Object.assign(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y }), {
    pointerId: 1,
  }) as unknown as PointerEvent;

const startDrag = (card: HTMLElement) => {
  act(() => { card.dispatchEvent(pointer('pointerdown', 10, 10)); });
  // Past the 5px threshold, so the drag is a drag and not a click.
  act(() => { window.dispatchEvent(pointer('pointermove', 80, 80)); });
};

describe('useBoardDrag cleanup', () => {
  it('marks the body while dragging', () => {
    const { getByTestId } = render(<StrictMode><Subject /></StrictMode>);
    startDrag(getByTestId('card'));
    expect(document.body.classList.contains('is-dragging')).toBe(true);
  });

  it('clears the body class when the drag ends normally', () => {
    const { getByTestId } = render(<StrictMode><Subject /></StrictMode>);
    startDrag(getByTestId('card'));
    act(() => { window.dispatchEvent(pointer('pointerup', 80, 80)); });
    expect(document.body.classList.contains('is-dragging')).toBe(false);
  });

  it('clears the body class when the board unmounts mid-drag', () => {
    const { getByTestId, unmount } = render(<StrictMode><Subject /></StrictMode>);
    startDrag(getByTestId('card'));
    expect(document.body.classList.contains('is-dragging')).toBe(true);

    unmount();

    /* body.is-dragging carries `* { cursor: grabbing !important }`. Left behind,
       every cursor in the app stays a closed fist until a reload. */
    expect(document.body.classList.contains('is-dragging')).toBe(false);
  });

  it('detaches its window listeners on unmount', () => {
    const { getByTestId, unmount } = render(<StrictMode><Subject /></StrictMode>);
    startDrag(getByTestId('card'));
    unmount();

    const spy = vi.spyOn(document.body.classList, 'add');
    // A stray pointermove after unmount must reach nothing.
    act(() => { window.dispatchEvent(pointer('pointermove', 200, 200)); });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('leaves the body alone when a press never becomes a drag', () => {
    const opened: string[] = [];
    const { getByTestId } = render(
      <StrictMode><Subject onOpenTicket={(k) => opened.push(k)} /></StrictMode>,
    );
    const card = getByTestId('card');
    act(() => { card.dispatchEvent(pointer('pointerdown', 10, 10)); });
    // Two pixels: a tap, not a drag.
    act(() => { window.dispatchEvent(pointer('pointermove', 12, 12)); });
    act(() => { window.dispatchEvent(pointer('pointerup', 12, 12)); });

    expect(document.body.classList.contains('is-dragging')).toBe(false);
    expect(opened).toEqual(['GAR-1']);   // it opened the ticket instead
  });
});
