import type { Page, PageQuery } from '@garage/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { isConfigured } from './supabase';
import { useDebouncedValue } from './useDebouncedValue';

export const PER_PAGE_OPTIONS = [25, 50, 100];

/** One page of a server-searched list: the rows on screen, the total for the
 *  pager, and the page/size/query that produced them.
 *
 *  The query is sent once typing pauses, and a new query goes back to page 1.
 *  A reply that arrives after a newer request was made is dropped, so a slow
 *  answer to "ab" never lands on top of the one to "abc". */
export function useServerPage<Row>(
  fetchPage: (q: PageQuery) => Promise<Page<Row>>,
  query: string,
  initialPerPage = 50,
) {
  const settled = useDebouncedValue(query.trim());
  const [page, setPage] = useState(1);
  const [perPage, setPerPageState] = useState(initialPerPage);
  const [data, setData] = useState<Page<Row>>({ rows: [], total: 0 });
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const seq = useRef(0);

  // A different question starts from its first page.
  useEffect(() => { setPage(1); }, [settled]);

  const reload = useCallback(() => {
    if (!isConfigured) { setLoaded(true); return Promise.resolve(); }
    const mine = ++seq.current;
    return fetchPage({ query: settled, page, pageSize: perPage })
      .then((next) => {
        if (mine !== seq.current) return;
        /* A page past the end — the last row of the last page was deleted, or
           a live change shrank the list — steps back rather than sitting on an
           empty table with a pager that says otherwise. */
        const pages = Math.max(1, Math.ceil(next.total / perPage));
        if (page > pages) { setPage(pages); return; }
        setData(next);
        setError(null);
      })
      .catch((e) => { if (mine === seq.current) setError(e); })
      .finally(() => { if (mine === seq.current) setLoaded(true); });
  }, [fetchPage, settled, page, perPage]);

  useEffect(() => { void reload(); }, [reload]);

  const setPerPage = useCallback((n: number) => { setPerPageState(n); setPage(1); }, []);

  const pages = Math.max(1, Math.ceil(data.total / perPage));
  const from = data.total === 0 ? 0 : (page - 1) * perPage + 1;
  const to = Math.min(page * perPage, data.total);

  return {
    rows: data.rows,
    total: data.total,
    loaded,
    error,
    reload,
    /** True while the box holds a query the rows do not answer yet. */
    searching: settled !== query.trim(),
    pager: { page, pages, perPage, from, to, total: data.total, onPage: setPage, onPerPage: setPerPage },
  };
}

/** Reload on a live change, folding a burst (one save touches several rows)
 *  into one read. */
export function useBurstReload(subscribe: (onChange: () => void) => () => void, reload: () => unknown, ms = 300) {
  const latest = useRef(reload);
  latest.current = reload;
  useEffect(() => {
    if (!isConfigured) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = subscribe(() => {
      clearTimeout(timer);
      timer = setTimeout(() => void latest.current(), ms);
    });
    return () => { clearTimeout(timer); off(); };
  }, [subscribe, ms]);
}
