import type { ReactNode } from 'react';

export interface SortState {
  key: string;
  /** 1 ascending, -1 descending. */
  dir: 1 | -1;
}

export interface Column<Row> {
  /** Stable identity, and the sort key. Unique within the table. */
  key: string;
  /** i18n key for the header. Omit for an actions column with no heading. */
  header?: string;
  /** For a header that is not text — an icon, a select-all checkbox. */
  renderHeader?: () => ReactNode;
  render: (row: Row, index: number) => ReactNode;
  /** Fixed width, so columns do not jump as content loads. */
  width?: number | string;
  align?: 'start' | 'center' | 'end';
  /** Extra class for every cell in the column. */
  cellClassName?: string;
  /** Present = sortable. The value the column sorts on, which is often not what
   *  it renders: a date cell shows 03/08 and sorts on a timestamp. */
  sortValue?: (row: Row) => string | number;
}
