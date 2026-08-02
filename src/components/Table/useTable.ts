import { useCallback, useMemo, useState } from 'react';
import type { Column, SortState } from './types';

/** Hebrew text does not sort correctly under `>` — and neither does anything
 *  with a number in it. `GAR-10` sorted before `GAR-2` on the board for exactly
 *  that reason. `numeric` fixes the second, the `he` collator the first. */
export function compareValues(a: string | number, b: string | number): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), 'he', { numeric: true, sensitivity: 'base' });
}

/** Pure, and exported for its own sake: the sort is the only part of a table
 *  worth testing, and testing it should not need a DOM. */
export function sortRows<Row>(
  rows: readonly Row[],
  columns: readonly Column<Row>[],
  sort: SortState | null,
): Row[] {
  if (!sort) return [...rows];

  const column = columns.find((c) => c.key === sort.key);
  const value = column?.sortValue;
  // A sort pointing at a column that has since been removed, or at one that was
  // never sortable, leaves the rows in the order the query returned them.
  if (!value) return [...rows];

  // Array.sort is stable, so rows that tie keep their incoming order rather
  // than shuffling on every re-render.
  return [...rows].sort((a, b) => compareValues(value(a), value(b)) * sort.dir);
}

export interface UseTableOptions<Row> {
  rows: readonly Row[];
  columns: readonly Column<Row>[];
  defaultSort?: SortState | null;
}

export function useTable<Row>({ rows, columns, defaultSort = null }: UseTableOptions<Row>) {
  const [sort, setSort] = useState<SortState | null>(defaultSort);

  /* A defaultSort naming a column that does not exist, or one with no
     sortValue, does nothing at all — the rows come out in query order and the
     screen looks plausible. That is a hard mistake to see and an easy one to
     make, so say so in development. */
  if (import.meta.env.DEV && defaultSort) {
    const column = columns.find((c) => c.key === defaultSort.key);
    if (!column) {
      console.warn(`Table: defaultSort "${defaultSort.key}" matches no column; rows are unsorted.`);
    } else if (!column.sortValue) {
      console.warn(`Table: column "${defaultSort.key}" has no sortValue; rows are unsorted.`);
    }
  }

  /* First click on a new column sorts ascending; clicking the sorted column
     flips it. There is no third state — an "unsorted" stop in the cycle means
     one stray click leaves the table in an order nobody asked for. */
  const toggleSort = useCallback((key: string) => {
    setSort((prev) => (prev?.key === key ? { key, dir: prev.dir === 1 ? -1 : 1 } : { key, dir: 1 }));
  }, []);

  const sorted = useMemo(() => sortRows(rows, columns, sort), [rows, columns, sort]);

  return { sorted, sort, setSort, toggleSort };
}
