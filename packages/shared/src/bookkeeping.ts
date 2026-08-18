/* Bookkeeping exports — the file the garage's accountant imports.

   For חשבשבת that is movein.dat, and the provider builds it in the format its
   software expects. Nothing here computes it: the accounting provider holds the
   chart of accounts, and a journal file we invented would be pointing at ledger
   codes we do not have.

   The shape is unlike anything else in the app because the provider's is: the
   order returns immediately and the file arrives minutes later, announced by a
   callback to an Edge Function. So the app orders, and then watches a row.

   See supabase/functions/export-bookkeeping and bookkeeping-ready, and the
   migration 20260814000000_bookkeeping_exports.sql. */

import { getClient } from './client';

export type ExportStatus = 'requested' | 'ready' | 'error';

export interface BookkeepingExport {
  id: string;
  startDate: string;             // YYYY-MM-DD
  endDate: string;
  docs: boolean;
  expenses: boolean;
  clients: boolean;
  suppliers: boolean;
  status: ExportStatus;
  error: string | null;
  /** Bytes on disk once it exists — worth showing, because an export that comes
   *  back nearly empty is usually a range with nothing in it rather than a
   *  failure, and the number is the fastest way to see that. */
  fileBytes: number | null;
  createdAt: string;
  readyAt: string | null;
}

/* Deliberately not selected: `callback_token`, which is the authorisation for a
   public endpoint, and `storage_path`, which the download helper resolves for
   itself. A column list rather than `*` is what keeps the first of those out of
   a browser even if the grant is ever loosened. */
const COLUMNS =
  'id, start_date, end_date, export_docs, export_expenses, export_clients, export_suppliers, status, error, file_bytes, created_at, ready_at';

const rowToExport = (r: any): BookkeepingExport => ({
  id: r.id,
  startDate: r.start_date,
  endDate: r.end_date,
  docs: r.export_docs,
  expenses: r.export_expenses,
  clients: r.export_clients,
  suppliers: r.export_suppliers,
  status: r.status,
  error: r.error ?? null,
  fileBytes: r.file_bytes ?? null,
  createdAt: r.created_at,
  readyAt: r.ready_at ?? null,
});

export const listBookkeepingExports = async (): Promise<BookkeepingExport[]> => {
  const { data, error } = await getClient()
    .from('bookkeeping_exports')
    .select(COLUMNS)
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) throw error;
  return (data ?? []).map(rowToExport);
};

export interface ExportRequest {
  startDate: string;
  endDate: string;
  docs?: boolean;
  expenses?: boolean;
  clients?: boolean;
  suppliers?: boolean;
}

/** Orders one. Resolves when the provider has ACCEPTED the job — the file does
 *  not exist yet, and the returned row says `requested`. What changes it is the
 *  callback, which is why the page subscribes rather than waits. */
export const requestBookkeepingExport = async (req: ExportRequest): Promise<BookkeepingExport> => {
  const { data, error } = await getClient().functions.invoke('export-bookkeeping', {
    body: {
      start_date: req.startDate,
      end_date: req.endDate,
      export_docs: req.docs,
      export_expenses: req.expenses,
      export_clients: req.clients,
      export_suppliers: req.suppliers,
    },
  });
  if (error) {
    let msg = error.message ?? 'export failed';
    try { const b = await error?.context?.json?.(); if (b?.error) msg = b.error; } catch { /* keep msg */ }
    throw new Error(msg);
  }
  return rowToExport(data.export);
};

/* Go back for a file the callback ran ahead of.
 *
 * The provider announces the export a little before the file is actually on the
 * other end, and how much is not fixed — a year of books is a bigger export than
 * a month of them. The callback waits and retries for about ninety seconds; when
 * that is not enough the export stays `requested` with the reason on it, and
 * this is how it is picked up afterwards. Nothing is re-ordered: the same file
 * is fetched from the link the provider already gave. */
export const retryBookkeepingExport = async (id: string): Promise<void> => {
  const { data, error } = await getClient().functions.invoke('export-bookkeeping', {
    body: { retry: id },
  });
  if (error) {
    let msg = error.message ?? 'retry failed';
    try { const b = await error?.context?.json?.(); if (b?.error) msg = b.error; } catch { /* keep msg */ }
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
};

/** Minutes: long enough to save the file, short enough that a URL copied out of
 *  a browser's history is no use to anybody later. */
const DOWNLOAD_TTL_SECONDS = 120;

/** A signed URL for the finished file. The bucket is private and read is scoped
 *  to the garage's own folder, so this can only ever sign what the caller is
 *  already allowed to read. */
export const bookkeepingExportUrl = async (id: string): Promise<string> => {
  const { data: row, error: rErr } = await getClient()
    .from('bookkeeping_exports')
    .select('storage_path, status')
    .eq('id', id)
    .maybeSingle();
  if (rErr) throw rErr;
  if (!row?.storage_path) throw new Error('this export has no file yet');

  const { data, error } = await getClient().storage
    .from('bookkeeping-exports')
    .createSignedUrl(row.storage_path, DOWNLOAD_TTL_SECONDS, { download: 'movein.dat' });
  if (error) throw error;
  return data.signedUrl;
};

/* The row changes minutes after it is written, by a caller that is not this
   browser — so realtime is not a nicety here, it is the only thing that turns
   "being prepared" into a download without the user reloading the page. */
export const subscribeToBookkeepingExports = (onChange: () => void) => {
  const channel = getClient()
    .channel(`garage-bookkeeping-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'bookkeeping_exports' }, onChange)
    .subscribe();
  return () => void getClient().removeChannel(channel);
};
