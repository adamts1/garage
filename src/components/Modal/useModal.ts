import { useEffect, useRef } from 'react';

export interface UseModalOptions {
  /** Only the topmost modal answers Escape. Without this, one keypress closes
   *  a confirm and the editor underneath it at the same time. */
  isTop: boolean;
  onClose: () => void;
}

export function useModal({ isTop, onClose }: UseModalOptions) {
  const panelRef = useRef<HTMLDivElement>(null);

  /* Held in a ref so the Escape listener does not resubscribe on every render
     just because the caller passed a fresh arrow function. */
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!isTop) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeRef.current();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isTop]);

  /* The page behind a modal must not scroll — on a trackpad it slides away
     under the dialog and leaves you somewhere else when the dialog closes.
     Counted, because a confirm opening over an editor would otherwise restore
     scrolling the moment the confirm closed, with the editor still up. */
  useEffect(() => {
    lockCount += 1;
    if (lockCount === 1) {
      previousOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    return () => {
      lockCount -= 1;
      if (lockCount === 0) document.body.style.overflow = previousOverflow;
    };
  }, []);

  /* Focus moves into the dialog on open, so the keyboard goes with it and
     Escape works without the user clicking first.

     `data-autofocus` wins over document order. Without it this landed on the
     first focusable thing in the panel, which is the ✕ — so a dialog got its
     dismiss button focused, and any `autoFocus` the caller had set was
     overridden a tick later by this effect. Whichever control the dialog is
     really about says so, and destructive dialogs point it at Cancel. */
  useEffect(() => {
    if (!isTop) return;
    const panel = panelRef.current;
    const target =
      panel?.querySelector<HTMLElement>('[data-autofocus]') ??
      panel?.querySelector<HTMLElement>(
        'input, select, textarea, button, [href], [tabindex]:not([tabindex="-1"])',
      );
    (target ?? panel)?.focus();
  }, [isTop]);

  return { panelRef };
}

let lockCount = 0;
let previousOverflow = '';
