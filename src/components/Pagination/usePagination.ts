import { useMemo, useState } from 'react';

export interface UsePaginationOptions<Row> {
  rows: readonly Row[];
  initialPerPage?: number;
}

export function usePagination<Row>({ rows, initialPerPage = 10 }: UsePaginationOptions<Row>) {
  const [perPage, setPerPage] = useState(initialPerPage);
  const [requested, setRequested] = useState(1);

  const pages = Math.max(1, Math.ceil(rows.length / perPage));

  /* Clamped rather than stored: filtering down from 8 pages to 2 while sitting
     on page 6 must not show an empty table. Deriving it means no effect has to
     notice the change and correct it. */
  const page = Math.min(requested, pages);

  const slice = useMemo(
    () => rows.slice((page - 1) * perPage, page * perPage),
    [rows, page, perPage],
  );

  const from = rows.length === 0 ? 0 : (page - 1) * perPage + 1;
  const to = Math.min(page * perPage, rows.length);

  return {
    slice,
    page,
    pages,
    perPage,
    total: rows.length,
    from,
    to,
    setPage: setRequested,
    setPerPage: (n: number) => { setPerPage(n); setRequested(1); },
  };
}
