/* Bookkeeping exports — the files the garage's accountant imports into ריווחית.

   The person ticks which of three they want: movein.dat (movements), heshin.dat
   (client and supplier cards) and heshin.prm (the layout of heshin.dat). The
   provider builds them (export_type rivhit — see _shared/bookkeepingParts.ts).
   Nothing here computes them: the accounting provider holds the chart of
   accounts, and a journal file we invented would be pointing at ledger codes we
   do not have.

   The shape is unlike anything else in the app because the provider's is: the
   order returns immediately and the file arrives minutes later, announced by a
   callback to an Edge Function. So the app orders, and then watches a row.

   See supabase/functions/export-bookkeeping and bookkeeping-ready, and the
   migrations 20260814000000_bookkeeping_exports.sql and
   20261112100000_bookkeeping_export_files.sql. */

import { getClient } from './client';

export type ExportStatus = 'requested' | 'ready' | 'error';

/** The files that can be asked for, in the order they are shown. */
export const BOOKKEEPING_FILES = ['movein.dat', 'heshin.dat', 'heshin.prm'] as const;
export type BookkeepingFile = typeof BOOKKEEPING_FILES[number];

/** The software the garage's bookkeeper imports into. It decides which files
 *  the provider is asked for — the two are not interchangeable. */
export type BookkeepingSoftware = 'rivhit' | 'hashavshevet';

export interface BookkeepingExport {
  id: string;
  startDate: string;             // YYYY-MM-DD
  endDate: string;
  docs: boolean;
  expenses: boolean;
  clients: boolean;
  suppliers: boolean;
  /** What was asked for. Old exports say ['movein.dat'], which is what they were. */
  files: BookkeepingFile[];
  /** What arrived, file name -> bytes. Null on exports from before the choice. */
  fileSizes: Record<string, number> | null;
  /** What the files were built for. Null on exports from before the setting. */
  software: BookkeepingSoftware | null;
  /** The most recent attempt to email it to the accountant, if any. */
  lastEmail: BookkeepingEmail | null;
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
  'id, start_date, end_date, export_docs, export_expenses, export_clients, export_suppliers, files, file_sizes, software, status, error, file_bytes, created_at, ready_at';

const rowToExport = (r: any): BookkeepingExport => ({
  id: r.id,
  startDate: r.start_date,
  endDate: r.end_date,
  docs: r.export_docs,
  expenses: r.export_expenses,
  clients: r.export_clients,
  suppliers: r.export_suppliers,
  files: r.files ?? ['movein.dat'],
  fileSizes: r.file_sizes ?? null,
  software: r.software ?? null,
  lastEmail: null,
  status: r.status,
  error: r.error ?? null,
  fileBytes: r.file_bytes ?? null,
  createdAt: r.created_at,
  readyAt: r.ready_at ?? null,
});

export interface BookkeepingEmail {
  status: 'sending' | 'sent' | 'error';
  to: string;
  cc: string | null;
  error: string | null;
  createdAt: string;
  sentAt: string | null;
}

export const listBookkeepingExports = async (): Promise<BookkeepingExport[]> => {
  const { data, error } = await getClient()
    .from('bookkeeping_exports')
    .select(COLUMNS)
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) throw error;
  const rows = (data ?? []).map(rowToExport);
  if (!rows.length) return rows;

  /* The latest send of each, newest first, so the first one seen per export
     is the one to show. Capped: twenty exports rarely carry more than a few
     sends each, and the page needs only the latest. */
  const { data: emails, error: eErr } = await getClient()
    .from('bookkeeping_export_emails')
    .select('export_id, status, to_email, cc_email, error, created_at, sent_at')
    .in('export_id', rows.map((r) => r.id))
    .order('created_at', { ascending: false })
    .limit(200);
  if (eErr) throw eErr;
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const e of emails ?? []) {
    const row = byId.get(e.export_id);
    if (row && !row.lastEmail) {
      row.lastEmail = {
        status: e.status, to: e.to_email, cc: e.cc_email ?? null,
        error: e.error ?? null, createdAt: e.created_at, sentAt: e.sent_at ?? null,
      };
    }
  }
  return rows;
};

export interface BookkeepingSettings {
  /** Null when nobody has set it — the server then refuses to export, and the
   *  page says why before anyone tries. */
  software: BookkeepingSoftware | null;
  /** Where "send to accountant" goes. Null: nothing can be sent. */
  accountantEmail: string | null;
}

export const getBookkeepingSettings = async (): Promise<BookkeepingSettings> => {
  const { data, error } = await getClient()
    .from('garage_billing')
    .select('bookkeeping_software, accountant_email')
    .maybeSingle();
  if (error) throw error;
  return {
    software: (data?.bookkeeping_software as BookkeepingSoftware | null) ?? null,
    accountantEmail: data?.accountant_email ?? null,
  };
};

/** Admin of the garage only, like the software. Empty clears it. */
export const setAccountantEmail = async (email: string): Promise<string | null> => {
  const { data, error } = await getClient().rpc('set_accountant_email', { p_email: email });
  if (error) throw error;
  return (data as string | null) ?? null;
};

/** Emails a ready export to the garage's accountant, from the server. Resolves
 *  once the email service has accepted it. */
export const sendBookkeepingExport = async (id: string): Promise<{ to: string; cc: string | null }> => {
  const { data, error } = await getClient().functions.invoke('send-bookkeeping', { body: { export_id: id } });
  if (error) {
    let msg = error.message ?? 'send failed';
    try { const b = await error?.context?.json?.(); if (b?.error) msg = b.error; } catch { /* keep msg */ }
    throw new Error(msg);
  }
  return { to: data.to, cc: data.cc ?? null };
};

/** Admin of the garage only — the database refuses anyone else, and the page
 *  only offers it to an admin. Returns what was stored. */
export const setBookkeepingSoftware = async (software: BookkeepingSoftware): Promise<BookkeepingSoftware> => {
  const { data, error } = await getClient().rpc('set_bookkeeping_software', { p_software: software });
  if (error) throw error;
  return data as BookkeepingSoftware;
};

export interface ExportRequest {
  startDate: string;
  endDate: string;
  files: BookkeepingFile[];
}

/** Orders one. Resolves when the provider has ACCEPTED the job — the file does
 *  not exist yet, and the returned row says `requested`. What changes it is the
 *  callback, which is why the page subscribes rather than waits. */
export const requestBookkeepingExport = async (req: ExportRequest): Promise<BookkeepingExport> => {
  const { data, error } = await getClient().functions.invoke('export-bookkeeping', {
    body: {
      start_date: req.startDate,
      end_date: req.endDate,
      files: req.files,
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

/** A signed URL for one finished file. The bucket is private and read is
 *  scoped to the garage's own folder, so this can only ever sign what the caller
 *  is already allowed to read. Refuses a file the export was not asked for, or
 *  an export that is not ready — never a half-finished set. */
export const bookkeepingExportUrl = async (id: string, file: BookkeepingFile): Promise<string> => {
  const { data: row, error: rErr } = await getClient()
    .from('bookkeeping_exports')
    .select('garage_id, status, files')
    .eq('id', id)
    .maybeSingle();
  if (rErr) throw rErr;
  if (!row) throw new Error('export not found');
  if (row.status !== 'ready') throw new Error('this export is not ready yet');
  if (!(row.files ?? ['movein.dat']).includes(file)) throw new Error(`${file} was not part of this export`);

  const { data, error } = await getClient().storage
    .from('bookkeeping-exports')
    .createSignedUrl(`${row.garage_id}/${id}/${file}`, DOWNLOAD_TTL_SECONDS, { download: file });
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
    /* Sends too — including ones made by someone else in the garage, which is
       what lets the page warn before the same files go out twice. */
    .on('postgres_changes', { event: '*', schema: 'public', table: 'bookkeeping_export_emails' }, onChange)
    .subscribe();
  return () => void getClient().removeChannel(channel);
};
