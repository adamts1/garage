import { useId } from 'react';

export interface UseFieldOptions {
  /** Already-resolved text, not a key — the hook does no translating. */
  hint?: string;
  error?: string;
  required?: boolean;
  disabled?: boolean;
}

/** What the label needs, and what the control needs, kept apart so neither has
 *  to know how the other is wired. */
export interface FieldIds {
  id: string;
  hintId: string;
  errorId: string;
  /** Spread onto the control. Carries the id the <label> points at, plus the
   *  aria that turns a red line of text into something a screen reader
   *  announces with the field rather than as loose prose. */
  controlProps: {
    id: string;
    'aria-describedby'?: string;
    'aria-invalid'?: boolean;
    'aria-required'?: boolean;
    disabled?: boolean;
  };
}

export function useField({ hint, error, required, disabled }: UseFieldOptions): FieldIds {
  /* useId, not a counter or a random string: it is stable across a re-render
     and matches between the server and client renderer, which a counter is not
     and does not. */
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;

  /* Order matters to a screen reader — it reads the description in the order
     given, and the error is the more urgent of the two. */
  const describedBy = [error ? errorId : null, hint ? hintId : null]
    .filter(Boolean)
    .join(' ');

  return {
    id,
    hintId,
    errorId,
    controlProps: {
      id,
      'aria-describedby': describedBy || undefined,
      'aria-invalid': error ? true : undefined,
      'aria-required': required || undefined,
      disabled: disabled || undefined,
    },
  };
}
