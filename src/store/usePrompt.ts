import { useCallback } from 'react';
import { useModalResult } from './useModalResult';

export interface PromptRequest {
  /** i18n key for the heading. */
  titleKey?: string;
  /** i18n key for the field label. */
  labelKey?: string;
  defaultValue?: string;
}

/**
 * Replaces `window.prompt`. Resolves the typed string, or null if dismissed —
 * and `''` is neither of those: it means the box was left empty on purpose, so
 * a caller can fall back to a default rather than abort.
 */
export function usePrompt() {
  const open = useModalResult<string>();

  return useCallback(
    (request: PromptRequest = {}) =>
      open('prompt', {
        titleKey: request.titleKey ?? 'prompt.title',
        labelKey: request.labelKey ?? 'prompt.label',
        defaultValue: request.defaultValue ?? '',
      }),
    [open],
  );
}
