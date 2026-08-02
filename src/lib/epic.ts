import { EPICS, type Ticket } from '@garage/shared';

export interface EpicChip {
  /** Label. */
  t: string;
  /** Background. */
  bg: string;
  /** Foreground. */
  c: string;
}

/**
 * `epic` is typed against the EPICS constant but arrives from the database, so
 * the type is a promise the row cannot keep: a value added server-side, or a
 * row written before a rename, indexes to `undefined`, and taking `.bg` off
 * that white-screens whichever page rendered it.
 *
 * Falling back to the raw value keeps the screen up and shows enough to work
 * out what the unknown epic is.
 */
export const epicChip = (epic: Ticket['epic']): EpicChip =>
  EPICS[epic] ?? { t: String(epic), bg: 'var(--surface-2)', c: 'var(--muted-d)' };
