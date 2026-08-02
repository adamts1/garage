// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { StrictMode, useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import '../../i18n';
import Modal from './Modal';

/* useModal keeps the scroll lock in module-level state shared by every modal,
   counted so a confirm opening over an editor does not restore scrolling when
   only the confirm closes.

   Shared mutable state plus an effect that increments on mount and decrements
   on cleanup is the shape that StrictMode punishes — it mounts, tears down and
   mounts again — so these render under StrictMode deliberately. */

afterEach(cleanup);

const noop = () => {};

function Stack({ open }: { open: 1 | 2 | 0 }) {
  return (
    <StrictMode>
      {open >= 1 && <Modal title="confirm.title" onClose={noop} isTop={open === 1}>a</Modal>}
      {open >= 2 && <Modal title="confirm.deleteTitle" onClose={noop} isTop stacked>b</Modal>}
    </StrictMode>
  );
}

describe('useModal scroll lock under StrictMode', () => {
  it('locks the page while a modal is open', () => {
    render(<Stack open={1} />);
    expect(document.body.style.overflow).toBe('hidden');
  });

  it('restores scrolling when it closes', () => {
    const { rerender } = render(<Stack open={1} />);
    expect(document.body.style.overflow).toBe('hidden');
    rerender(<Stack open={0} />);
    expect(document.body.style.overflow).toBe('');
  });

  it('stays locked while a second modal is open over the first', () => {
    const { rerender } = render(<Stack open={1} />);
    rerender(<Stack open={2} />);
    expect(document.body.style.overflow).toBe('hidden');
  });

  it('closing only the top modal leaves the page locked', () => {
    const { rerender } = render(<Stack open={2} />);
    rerender(<Stack open={1} />);
    // The editor underneath is still up; the page must not start scrolling.
    expect(document.body.style.overflow).toBe('hidden');
  });

  it('unlocks only once the last modal closes', () => {
    const { rerender } = render(<Stack open={2} />);
    rerender(<Stack open={1} />);
    rerender(<Stack open={0} />);
    expect(document.body.style.overflow).toBe('');
  });

  it('does not leak a lock across open/close cycles', () => {
    // A miscounted lock would show up here: after three full cycles the page
    // would still be frozen with nothing on screen.
    for (let i = 0; i < 3; i += 1) {
      const { rerender, unmount } = render(<Stack open={1} />);
      rerender(<Stack open={0} />);
      unmount();
    }
    expect(document.body.style.overflow).toBe('');
  });
});

describe('Modal dismissal', () => {
  function Escapable() {
    const [open, setOpen] = useState(true);
    return (
      <StrictMode>
        {open && (
          <Modal title="confirm.title" onClose={() => setOpen(false)}>
            body
          </Modal>
        )}
      </StrictMode>
    );
  }

  it('Escape closes the modal exactly once', () => {
    render(<Escapable />);
    expect(screen.getByRole('dialog')).toBeTruthy();
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.body.style.overflow).toBe('');
  });
});
