import { nanoid } from '@reduxjs/toolkit';
import { useCallback } from 'react';
import { useAppDispatch } from './index';
import { modalOpened } from './modalSlice';

export interface ConfirmRequest {
  /** i18n key for the heading. */
  titleKey?: string;
  /** i18n key for the body. */
  bodyKey: string;
  /** Interpolated into the body — a name, a count. */
  name?: string;
  /** Colours the primary button as destructive. */
  danger?: boolean;
}

/* Redux actions have to stay serialisable, so the resolver cannot live in the
   store. It lives here, keyed by an id that does go in the store, and the modal
   settles it by that id.

   Every entry is removed as it settles, which is what makes the unmount path in
   ConfirmModal safe to call unconditionally: a dialog dismissed by Escape or by
   a route change resolves false instead of leaving its caller awaiting a
   promise that nothing will ever settle. */
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
 *     if (!(await confirm({ bodyKey: 'suppliers.confirmDelete', name: s.name }))) return;
 */
export function useConfirm() {
  const dispatch = useAppDispatch();

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
              name: request.name ?? null,
              danger: request.danger ?? false,
            },
          }),
        );
      }),
    [dispatch],
  );
}
