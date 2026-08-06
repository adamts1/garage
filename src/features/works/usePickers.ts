import type { PartDef, WorkDef } from '@garage/shared';
import { useCallback } from 'react';
import { useModalResult } from '../../store';

/** Opens the work picker and resolves the chosen work, or null if dismissed. */
export function usePickWork() {
  const open = useModalResult<WorkDef>();
  return useCallback(
    (options: { initialQuery?: string; taken?: string[] } = {}) =>
      open('workPicker', {
        initialQuery: options.initialQuery ?? '',
        /* Codes already on the ticket. Flattened to a string for the same
           reason the part picker's SKUs are: the store carries flat values,
           and toCatalogCode leaves no commas in a code. */
        taken: (options.taken ?? []).join(','),
      }),
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
