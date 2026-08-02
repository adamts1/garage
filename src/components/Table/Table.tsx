import { Fragment, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import styles from './Table.module.css';
import type { Column, SortState } from './types';
import { useTable } from './useTable';

/** What a screen reader announces for the column: which way it is sorted, or
 *  that it is sortable and currently not sorted. */
const ariaSort = (sort: SortState | null): 'ascending' | 'descending' | 'none' =>
  sort ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none';

export interface TableProps<Row> {
  columns: readonly Column<Row>[];
  rows: readonly Row[];
  /** Stable per row. Prefer an id: these tables re-sort, and a positional key
   *  then attaches the wrong DOM node to the wrong row. The index is passed for
   *  the case where position genuinely is the identity — an invoice's line
   *  items are a frozen JSON array with no ids and no sorting. */
  rowKey: (row: Row, index: number) => string;
  /** i18n key shown in place of the body when there are no rows. */
  emptyKey?: string;
  /** Overrides emptyKey — for "nothing matched <query>" as against "none yet",
   *  which are different things to tell someone. */
  empty?: ReactNode;
  onRowClick?: (row: Row) => void;
  isRowSelected?: (row: Row) => boolean;
  defaultSort?: SortState | null;
  /** A full-width detail row underneath this one — a panel that belongs to the
   *  row rather than a column of it. Return null for the closed state, which is
   *  how the caller keeps the open/closed decision. */
  renderExpanded?: (row: Row, index: number) => ReactNode;

  /** A whole extra row under the body: totals, "12 of 340". */
  footer?: ReactNode;
  className?: string;

  /* ---- controlled sorting ----
     Passing `onToggleSort` hands the sort to the caller: `rows` is then taken
     as already sorted and `sort` only drives the header arrows. Paginated
     tables need this — sorting has to happen across the whole set before it is
     sliced, or each page sorts only itself. */
  sort?: SortState | null;
  onToggleSort?: (key: string) => void;

  /** Makes the per-column widths binding instead of hints. Auto layout lets a
   *  long value in one cell starve the numeric columns down to empty boxes;
   *  with this the widths hold. Off by default — most tables want auto. */
  fixedLayout?: boolean;
}

export default function Table<Row>({
  columns,
  rows,
  rowKey,
  emptyKey = 'table.empty',
  empty,
  onRowClick,
  isRowSelected,
  defaultSort = null,
  renderExpanded,
  footer,
  className,
  sort: sortProp,
  onToggleSort,
  fixedLayout = false,
}: TableProps<Row>) {
  const { t } = useTranslation();
  const internal = useTable({ rows, columns, defaultSort });

  const controlled = onToggleSort !== undefined;
  const sorted = controlled ? rows : internal.sorted;
  const sort = controlled ? (sortProp ?? null) : internal.sort;
  const toggleSort = controlled ? onToggleSort : internal.toggleSort;

  return (
    <div className={[styles.wrap, className].filter(Boolean).join(' ')}>
      <table className={[styles.table, fixedLayout ? styles.fixed : null].filter(Boolean).join(' ')}>
        <thead>
          <tr>
            {columns.map((c) => {
              const sortable = Boolean(c.sortValue);
              const active = sort?.key === c.key;
              return (
                <th
                  key={c.key}
                  style={{ width: c.width, textAlign: c.align }}
                  className={[
                    sortable ? styles.sortable : null,
                    active ? styles.sorted : null,
                  ].filter(Boolean).join(' ')}
                  onClick={sortable ? () => toggleSort(c.key) : undefined}
                  /* A th that sorts is a control. Without this it is a
                     mouse-only affordance — reachable by no keyboard. */
                  {...(sortable
                    ? {
                        role: 'button' as const,
                        tabIndex: 0,
                        'aria-sort': ariaSort(active ? sort : null),
                        onKeyDown: (e: React.KeyboardEvent) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            toggleSort(c.key);
                          }
                        },
                      }
                    : {})}
                >
                  {c.renderHeader ? c.renderHeader() : c.header ? t(c.header) : null}
                  {sortable && (
                    <span className={styles.sortArrow} aria-hidden="true">
                      {active ? (sort.dir === 1 ? '▲' : '▼') : ''}
                    </span>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>

        <tbody>
          {sorted.map((row, i) => {
            const expanded = renderExpanded?.(row, i);
            return (
              /* Fragment rather than nesting: a detail panel inside the row's
                 own <td> would sit in one column and inherit its width. */
              <Fragment key={rowKey(row, i)}>
                <tr
                  className={[
                    onRowClick ? styles.clickable : null,
                    isRowSelected?.(row) ? styles.selected : null,
                  ].filter(Boolean).join(' ')}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                >
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      style={{ textAlign: c.align }}
                      className={c.cellClassName}
                    >
                      {c.render(row, i)}
                    </td>
                  ))}
                </tr>

                {expanded != null && (
                  <tr className={styles.expandedRow}>
                    <td colSpan={columns.length} className={styles.expanded}>
                      {expanded}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}

          {sorted.length === 0 && (
            <tr>
              <td colSpan={columns.length} className={styles.empty}>
                {empty ?? t(emptyKey)}
              </td>
            </tr>
          )}
        </tbody>

        {footer && (
          <tfoot>
            <tr>
              <td colSpan={columns.length} className={styles.footer}>
                {footer}
              </td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
