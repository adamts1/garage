import { nanoid } from '@reduxjs/toolkit';
import { useCallback } from 'react';
import { useAppDispatch, useAppStore } from './index';
import { modalOpened, type ModalProps } from './modalSlice';

/* Redux actions have to stay serialisable, so a modal cannot be handed a
   callback to answer through. The resolver lives here instead, keyed by an id
   that does go in the store.

   The fallback — answering when the dialog is dismissed rather than used — is
   tied to the store, not to a component's lifetime. It used to live in an
   unmount cleanup, and React StrictMode's effect replay then answered the
   instant the dialog appeared: every delete in the app silently did nothing.
   See useConfirm.test.tsx. */
const pending = new Map<string, (value: unknown) => void>();

/** Called by a modal to hand its answer back. Settling twice is a no-op. */
export function settleModal(resultId: string, value: unknown) {
  const resolve = pending.get(resultId);
  if (!resolve) return;
  pending.delete(resultId);
  resolve(value);
}

/**
 * Opens a modal from the registry and waits for its answer.
 *
 *     const pickWork = useModalResult<WorkDef>();
 *     const chosen = await pickWork('workPicker', { initialQuery: 'בלם' });
 *     if (!chosen) return;   // dismissed
 *
 * Resolves `null` when the dialog leaves the stack without answering — closed
 * by Escape, the scrim, or `modalsCleared`.
 */
export function useModalResult<T>() {
  const dispatch = useAppDispatch();
  const store = useAppStore();

  return useCallback(
    (name: string, props: ModalProps = {}) =>
      new Promise<T | null>((resolve) => {
        const resultId = nanoid();
        pending.set(resultId, resolve as (value: unknown) => void);

        dispatch(modalOpened({ name, props: { ...props, resultId } }));

        /* Subscribed after the dispatch, so the dialog is already on the stack
           and the first notification cannot read "not open yet" as "closed". */
        const unsubscribe = store.subscribe(() => {
          if (!pending.has(resultId)) {
            unsubscribe();   // answered from inside the modal; nothing to do
            return;
          }
          const open = store
            .getState()
            .modal.stack.some((m) => m.props.resultId === resultId);
          if (!open) {
            unsubscribe();
            settleModal(resultId, null);
          }
        });
      }),
    [dispatch, store],
  );
}
