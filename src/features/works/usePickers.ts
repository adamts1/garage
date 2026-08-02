import type { PartDef, WorkDef } from '@garage/shared';
import { useCallback } from 'react';
import { useModalResult } from '../../store';

/** Opens the work picker and resolves the chosen work, or null if dismissed. */
export function usePickWork() {
  const open = useModalResult<WorkDef>();
  return useCallback(
    (options: { initialQuery?: string } = {}) =>
      open('workPicker', { initialQuery: options.initialQuery ?? '' }),
    [open],
  );
}

/** Opens the part picker and resolves the chosen part, or null if dismissed. */
export function usePickPart() {
  const open = useModalResult<PartDef>();
  return useCallback(
    (options: { initialQuery?: string; taken?: string[] } = {}) =>
      open('partPicker', {
        initialQuery: options.initialQuery ?? '',
        /* Flattened to a string: the store carries only flat values, and a SKU
           cannot contain a comma. */
        taken: (options.taken ?? []).join(','),
      }),
    [open],
  );
}
