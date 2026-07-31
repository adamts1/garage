import type { ReactNode } from 'react';
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
  /** Stable per row. Index is not a key here — these tables re-sort. */
  rowKey: (row: Row) => string;
  /** i18n key shown in place of the body when there are no rows. */
  emptyKey?: string;
  /** Overrides emptyKey — for "nothing matched <query>" as against "none yet",
   *  which are different things to tell someone. */
  empty?: ReactNode;
  onRowClick?: (row: Row) => void;
  isRowSelected?: (row: Row) => boolean;
  defaultSort?: SortState | null;
  /** A whole extra row under the body: totals, "12 of 340". */
  footer?: ReactNode;
  className?: string;
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
  footer,
  className,
}: TableProps<Row>) {
  const { t } = useTranslation();
  const { sorted, sort, toggleSort } = useTable({ rows, columns, defaultSort });

  return (
    <div className={[styles.wrap, className].filter(Boolean).join(' ')}>
      <table className={styles.table}>
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
          {sorted.map((row, i) => (
            <tr
              key={rowKey(row)}
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
          ))}

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
