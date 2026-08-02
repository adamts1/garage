import { useCallback } from 'react';
import { useModalResult } from './useModalResult';

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

/**
 * Replaces `window.confirm`, which blocks the main thread, cannot be styled,
 * cannot be translated and is suppressed outright by some browsers.
 *
 *     if (!(await confirm({ bodyKey: 'suppliers.confirmDelete', values: { name } }))) return;
 *
 * A dismissed dialog resolves null, which is a "no" — the safe reading for a
 * question nobody answered.
 */
export function useConfirm() {
  const open = useModalResult<boolean>();

  return useCallback(
    async (request: ConfirmRequest) => {
      const answer = await open('confirm', {
        titleKey: request.titleKey ?? 'confirm.title',
        bodyKey: request.bodyKey,
        values: request.values ?? {},
        danger: request.danger ?? false,
      });
      return answer ?? false;
    },
    [open],
  );
}
