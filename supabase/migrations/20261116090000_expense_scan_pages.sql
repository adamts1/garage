-- Scan pages upload while the next one is being photographed (2026-11-16).
--
-- Until now a scan's pages were named by position — page-1.jpg, page-2.jpg —
-- and the page count was fixed when the scan started, so nothing could upload
-- before סיום: a page deleted, retaken or moved after it was uploaded would have
-- sat at the wrong number, and the bucket allows no overwrite or delete.
--
-- Now each page uploads as soon as it is taken, under a name of its own
-- ({garage_id}/{scan_id}/{name}.jpg), and the order is decided at סיום: the app
-- hands extract-invoice the final list, which it checks (bare names only, inside
-- this scan's folder) and stores here. A page deleted or retaken after it was
-- uploaded stays in the folder unreferenced — it was never part of the invoice.
--
-- Scans started before this have no `pages` and are read as page-1…page-n from
-- page_count, as before.

alter table public.expense_scans
  add column if not exists pages text[];

comment on column public.expense_scans.pages is
  'The invoice''s pages in order: object names inside {garage_id}/{id}/ in the expense-scans bucket, set by extract-invoice from the list the app sends at סיום. NULL on scans from before 2026-11-16, whose pages are page-1.jpg…page-{page_count}.jpg.';

/* The count is known only at סיום now, so a scan starts without one and
   extract-invoice sets it with `pages`. 1 is a placeholder the check accepts. */
alter table public.expense_scans
  alter column page_count set default 1;
