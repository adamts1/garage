/* Reading past PostgREST's row cap, and reading one page of it.

   A select returns at most 1000 rows (the project's max-rows), and says
   nothing when it stops there: a list that "works" in a new garage loses rows
   the month it crosses a thousand. Two ways round it, for two kinds of list:

   - fetchAll: a list the app genuinely needs whole — the board's tickets, the
     invoices the income report adds up. Read in ranges until a short one.
     Every query handed to it must have a total order (end it on a unique
     column), or rows can repeat or go missing between ranges.

   - Page / pageRange: a list a person reads — customers, cars. Only the page
     on screen is fetched, with the total for the pager. */

/** Rows per request when reading a whole list. Under the server's cap. */
export const FETCH_ALL_CHUNK = 1000;

type Ranged<T> = (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>;

/** Every row of a query, however many there are. */
export async function fetchAll<T>(range: Ranged<T>, chunk = FETCH_ALL_CHUNK): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += chunk) {
    const { data, error } = await range(from, from + chunk - 1);
    if (error) throw error;
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < chunk) return out;
  }
}

/** Rows a list screen shows at once. */
export const PAGE_SIZE = 50;

export interface Page<T> {
  rows: T[];
  /** Every match, not just this page — what the pager counts from. */
  total: number;
}

/** The inclusive row range of a 1-based page. */
export const pageRange = (page: number, size = PAGE_SIZE): [number, number] => {
  const from = (Math.max(1, Math.floor(page)) - 1) * size;
  return [from, from + size - 1];
};
