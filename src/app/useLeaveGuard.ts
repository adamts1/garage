import { useCallback, useEffect, useRef } from 'react';
import { useBlocker, type BlockerFunction } from 'react-router-dom';
import { useConfirm } from '../store';

/* Asks before unsaved work on a ticket is thrown away — by ANY way out. That is
   an open ticket with edits, and equally a new one somebody has started filling
   in: the intake form is the longer of the two to type again.

   The ticket page used to ask only from its own close button. The sidebar, the
   browser's Back button and signing out all left without a word, and each of
   them starts outside the page, so the page cannot catch them itself. The shell
   holds this instead: the page reports whether it has unsaved edits, and every
   exit is checked here.

   Router navigation — links, navigate(), Back and Forward — is held by
   useBlocker, which needs the data router set up in main.tsx. Signing out is not
   a navigation (AuthGate just stops rendering the app), so the sidebar asks
   through confirmDiscard() before it signs out. Closing or reloading the tab is
   the one exit no in-app dialog can stand in front of; the ticket page hands
   that to the browser's own beforeunload prompt. */
export function useLeaveGuard() {
  const confirm = useConfirm();

  /* What there is to lose, as the i18n key of the question to ask about it —
     null when nothing. A ticket being edited and one still being opened lose
     different things, so each says so in its own words.

     A ref, not state: it is read inside the blocker at the moment of
     navigation, and a delete or a save has to be able to clear it and navigate
     in the same tick. */
  const unsaved = useRef<string | null>(null);
  const setUnsaved = useCallback((dirty: boolean, bodyKey = 'ticket.confirmLeave') => {
    unsaved.current = dirty ? bodyKey : null;
  }, []);

  /* Moving within the same path (a query string, a hash) keeps the page
     mounted and the edits with it — nothing to ask about. */
  const shouldBlock = useCallback<BlockerFunction>(
    ({ currentLocation, nextLocation }) =>
      unsaved.current !== null && currentLocation.pathname !== nextLocation.pathname,
    [],
  );
  const blocker = useBlocker(shouldBlock);

  /* Keyed on the state alone. The blocker object is rebuilt on every render,
     and the shell re-renders on every realtime ticket update — keyed on the
     object, a second dialog would open over the first. */
  const blockerRef = useRef(blocker);
  blockerRef.current = blocker;
  const confirmRef = useRef(confirm);
  confirmRef.current = confirm;

  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    const bodyKey = unsaved.current ?? 'ticket.confirmLeave';
    void confirmRef.current({ bodyKey, danger: true }).then((ok) => {
      const current = blockerRef.current;
      if (current.state !== 'blocked') return;
      if (ok) {
        unsaved.current = null;
        current.proceed();
      } else {
        current.reset();
      }
    });
  }, [blocker.state]);

  /** For the exits that are not navigations. Resolves true when there is
   *  nothing to lose, or the user agreed to lose it. */
  const confirmDiscard = useCallback(
    async () =>
      unsaved.current === null || confirm({ bodyKey: unsaved.current, danger: true }),
    [confirm],
  );

  return { setUnsaved, confirmDiscard };
}
