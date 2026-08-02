import { nanoid } from '@reduxjs/toolkit';
import { useCallback } from 'react';
import { useAppDispatch, useAppStore } from './index';
import { modalOpened } from './modalSlice';

export interface ConfirmRequest {
  /** i18n key for the heading. */
  titleKey?: string;
  /** i18n key for the body. Pick the key that fits the case rather than
   *  assembling a sentence from fragments — "delete X" and "delete X, and 34
   *  tickets lose their owner" are different questions, and a translator needs
   *  to see each one whole. */
  bodyKey: string;
  /** Interpolated into the body: a name, a count. */
  values?: Record<string, string | number>;
  /** Colours the confirming button as destructive, and starts focus on Cancel. */
  danger?: boolean;
}

/* Redux actions have to stay serialisable, so the resolver cannot live in the
   store. It lives here, keyed by an id that does. */
const pending = new Map<string, (answer: boolean) => void>();

export function settleConfirm(confirmId: string, answer: boolean) {
  const resolve = pending.get(confirmId);
  if (!resolve) return;
  pending.delete(confirmId);
  resolve(answer);
}

/**
 * Replaces `window.confirm`, which blocks the main thread, cannot be styled,
 * cannot be translated and is suppressed outright by some browsers.
 *
 *     if (!(await confirm({ bodyKey: 'suppliers.confirmDelete', values: { name } }))) return;
 *
 * A dialog dismissed by Escape, the scrim or a `modalsCleared` still has to
 * answer, or the caller waits on a promise nothing will ever settle. That
 * "answer no on the way out" used to live in ConfirmModal's unmount cleanup,
 * and it made every delete in the app silently do nothing:
 *
 *   React StrictMode mounts, runs effects, tears them down and mounts again.
 *   The teardown ran while the dialog was still on screen, so the promise
 *   resolved false before anyone could click, `if (!ok) return` took the early
 *   exit, and the row stayed exactly where it was — with no error to show for
 *   it, because nothing had failed.
 *
 * So the fallback is tied to the store rather than to a component's lifetime:
 * when the modal leaves the stack unanswered, it answers no. React can mount
 * and unmount as often as it likes.
 */
export function useConfirm() {
  const dispatch = useAppDispatch();
  const store = useAppStore();

  return useCallback(
    (request: ConfirmRequest) =>
      new Promise<boolean>((resolve) => {
        const confirmId = nanoid();
        pending.set(confirmId, resolve);

        dispatch(
          modalOpened({
            name: 'confirm',
            props: {
              confirmId,
              titleKey: request.titleKey ?? 'confirm.title',
              bodyKey: request.bodyKey,
              values: request.values ?? {},
              danger: request.danger ?? false,
            },
          }),
        );

        /* Subscribed after the dispatch, so the dialog is already in the stack
           and the first notification cannot mistake "not open yet" for
           "closed". */
        const unsubscribe = store.subscribe(() => {
          if (!pending.has(confirmId)) {
            unsubscribe();   // answered by the buttons; nothing left to do
            return;
          }
          const open = store
            .getState()
            .modal.stack.some((m) => m.props.confirmId === confirmId);
          if (!open) {
            unsubscribe();
            settleConfirm(confirmId, false);
          }
        });
      }),
    [dispatch, store],
  );
}
