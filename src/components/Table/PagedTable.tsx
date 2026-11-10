import { Pagination, usePagination } from '../Pagination';
import Table, { type TableProps } from './Table';
import { useTable } from './useTable';

export const PAGED_TABLE_PER_PAGE = [25, 50, 100];

/** A table that draws one page of its rows at a time.
 *
 *  For lists the app holds whole anyway — the archive, invoices, expenses,
 *  which the reports add up — but that nobody reads a thousand rows of at
 *  once. Drawing them all made every visit to those screens, and every live
 *  update while on them, lay out the whole list. Sorting stays across every
 *  row (it is lifted out of the table), and only the page is sliced. The pager
 *  appears once there is more than one page. */
export default function PagedTable<Row>({
  rows, columns, defaultSort = null, perPage = 50, ...rest
}: Omit<TableProps<Row>, 'sort' | 'onToggleSort'> & { perPage?: number }) {
  const { sorted, sort, toggleSort } = useTable({ rows, columns, defaultSort });
  const pager = usePagination({ rows: sorted, initialPerPage: perPage });
  return (
    <>
      <Table {...rest} columns={columns} rows={pager.slice} sort={sort} onToggleSort={toggleSort} />
      {pager.total > pager.perPage && (
        <Pagination
          page={pager.page}
          pages={pager.pages}
          perPage={pager.perPage}
          from={pager.from}
          to={pager.to}
          total={pager.total}
          onPage={pager.setPage}
          onPerPage={pager.setPerPage}
          perPageOptions={PAGED_TABLE_PER_PAGE}
        />
      )}
    </>
  );
}
