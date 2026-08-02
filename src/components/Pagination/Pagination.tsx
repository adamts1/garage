import { useTranslation } from 'react-i18next';
import styles from './Pagination.module.css';

/** A gap in the page list, rendered as an ellipsis. */
export const GAP = 'gap' as const;

/**
 * Which page buttons to show. The old pager rendered one button per page, so a
 * garage with 400 customers got 40 of them wrapped across the footer.
 *
 * Always shows the first and last page, and `radius` either side of the
 * current one, with gaps between. Pure, and exported so the edge cases can be
 * tested without a DOM.
 */
export function pageWindow(pages: number, current: number, radius = 1): (number | typeof GAP)[] {
  if (pages <= 1) return [1];

  /* Below this there is nothing to gain by hiding anything — seven buttons fit
     comfortably, and "1 2 … 5" is both wider and less useful than "1 2 3 4 5".
     Collapsing only pays once the list would wrap. */
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);

  const wanted = new Set<number>([1, pages]);
  for (let p = current - radius; p <= current + radius; p += 1) {
    if (p >= 1 && p <= pages) wanted.add(p);
  }

  const sorted = [...wanted].sort((a, b) => a - b);
  const out: (number | typeof GAP)[] = [];
  sorted.forEach((p, i) => {
    const previous = sorted[i - 1];
    // A gap of exactly one page is written out — "1 … 3" is wider than "1 2 3"
    // and tells you less.
    if (previous !== undefined && p - previous === 2) out.push(p - 1);
    else if (previous !== undefined && p - previous > 2) out.push(GAP);
    out.push(p);
  });
  return out;
}

export interface PaginationProps {
  page: number;
  pages: number;
  perPage: number;
  from: number;
  to: number;
  total: number;
  onPage: (page: number) => void;
  onPerPage: (perPage: number) => void;
  perPageOptions?: number[];
}

export default function Pagination({
  page, pages, perPage, from, to, total, onPage, onPerPage,
  perPageOptions = [10, 25, 50],
}: PaginationProps) {
  const { t } = useTranslation();

  return (
    <div className={styles.foot}>
      <label className={styles.perPage}>
        <span>{t('pagination.perPage')}</span>
        <select value={perPage} onChange={(e) => onPerPage(Number(e.target.value))}>
          {perPageOptions.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </label>

      <div className={styles.spacer} />

      <div className={styles.pager}>
        {/* RTL: › is the way back. */}
        <button
          type="button"
          disabled={page === 1}
          onClick={() => onPage(page - 1)}
          aria-label={t('pagination.previous')}
        >
          ›
        </button>

        {pageWindow(pages, page).map((entry, i) =>
          entry === GAP ? (
            <span key={`gap-${i}`} className={styles.gap} aria-hidden="true">…</span>
          ) : (
            <button
              key={entry}
              type="button"
              className={entry === page ? styles.on : undefined}
              onClick={() => onPage(entry)}
              aria-current={entry === page ? 'page' : undefined}
            >
              {entry}
            </button>
          ),
        )}

        <button
          type="button"
          disabled={page === pages}
          onClick={() => onPage(page + 1)}
          aria-label={t('pagination.next')}
        >
          ‹
        </button>
      </div>

      <span className={styles.count}>
        {total === 0 ? t('pagination.none') : t('pagination.range', { from, to, total })}
      </span>
    </div>
  );
}
