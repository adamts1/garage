-- The link the provider sent, kept so a download that was merely early can be
-- tried again.
--
-- The callback announces the export before the file is actually on the other
-- end — measured at more than fifteen seconds behind, and there is no reason to
-- think that is a constant: a year of books is a bigger file than a month of
-- them. The first version fetched once and, failing that, wrote the export off
-- as an error. The file then appeared, and nothing was ever going to go back
-- for it, because the only pointer to it had been in a request body that was
-- already gone.
--
-- So the pointer is written down before anything is attempted with it. A failed
-- fetch now leaves the export exactly where it was — still `requested`, with
-- the reason on it — and retryable, by the page or by hand, for as long as the
-- provider keeps the file.
--
-- Deliberately NOT added to the column grant below it: the link is
-- unauthenticated, and a garage's books are not something to hand a browser on
-- a URL that anybody holding it can fetch. It stays server-side, like the
-- callback token.

alter table public.bookkeeping_exports
  add column if not exists source_url text;

comment on column public.bookkeeping_exports.source_url is
  'Where the provider said the file would be. Server-side only — it is an unauthenticated link. Kept so a fetch that ran ahead of the file can be retried instead of losing the export.';
