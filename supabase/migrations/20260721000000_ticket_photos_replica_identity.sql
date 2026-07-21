-- ticket_photos was created without REPLICA IDENTITY FULL.
--
-- Every other table has it, and the baseline sets it — the original
-- ticket-photos.sql simply never did. The gap only became visible when a
-- freshly built staging database was diffed against production.
--
-- Effect: without it, a realtime DELETE payload carries only the primary key
-- rather than the deleted row. Nothing reads that payload today
-- (subscribeToTicketPhotos just refetches), so this is drift rather than a
-- live bug — but the two databases should not disagree.
--
-- Safe to apply anywhere: setting replica identity twice is a no-op, so this
-- is already-satisfied on staging and corrective on production. The lock is
-- brief and the table is tiny.

alter table public.ticket_photos replica identity full;
