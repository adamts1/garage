import type { BookkeepingExport, BookkeepingFile } from '@garage/shared';

/* "Download all": one zip per export, for the person to attach to an email.
 *
 * Why a zip rather than three downloads. Every export's files have the same
 * names — movein.dat is movein.dat in every month — so two months downloaded
 * one by one land as `movein.dat` and `movein (1).dat`, and the wrong month is
 * one attachment away. The zip carries the garage, the software and the period
 * in its own name, and keeps the files inside under their exact names, which is
 * what ריווחית and חשבשבת look for when importing.
 *
 * Built in the browser from the files already stored for the export. Every
 * file is checked before it goes in: it must arrive, must not be empty, and
 * must be exactly the size recorded when the server stored it. A zip missing a
 * file, or holding a truncated one, is refused — the person gets an error,
 * never a partial set that looks complete. */

/** Characters no file system takes in a name, and whitespace — any run of
 *  them becomes one dash. */
const unsafe = /[\\/:*?"<>|\s\u0000-\u001f]+/g;

/** e.g. "testing_ריווחית_2026-10-01_2026-10-31.zip" */
export function zipName(garage: string, softwareLabel: string | null, row: Pick<BookkeepingExport, 'startDate' | 'endDate'>): string {
  const parts = [garage, softwareLabel, row.startDate, row.endDate]
    .filter((p): p is string => Boolean(p && p.trim()))
    .map((p) => p.trim().replace(unsafe, '-').replace(/^-+|-+$/g, ''));
  return `${parts.join('_')}.zip`;
}

/** Fetches one stored file. Injected so the checks below can be tested
 *  without a network. */
export type FetchFile = (file: BookkeepingFile) => Promise<Uint8Array>;

/** The checked bytes of every file the export holds, ready to zip. Throws,
 *  naming the file, on the first one that is missing, empty or the wrong size. */
export async function collectFiles(
  row: Pick<BookkeepingExport, 'status' | 'files' | 'fileSizes'>,
  fetchFile: FetchFile,
): Promise<Record<string, Uint8Array>> {
  if (row.status !== 'ready') throw new Error('this export is not ready yet');
  if (!row.files.length) throw new Error('this export has no files');

  const out: Record<string, Uint8Array> = {};
  for (const file of row.files) {
    const bytes = await fetchFile(file);
    if (!bytes.byteLength) throw new Error(`${file} is empty`);
    /* Old exports have no recorded sizes; for those the empty check is all
       there is. */
    const expected = row.fileSizes?.[file];
    if (expected != null && expected !== bytes.byteLength) {
      throw new Error(`${file} is ${bytes.byteLength} bytes but ${expected} were stored — download stopped`);
    }
    out[file] = bytes;
  }
  return out;
}

/** The zip itself. fflate is loaded only when somebody actually asks for a zip,
 *  so it costs the rest of the app nothing. */
export async function makeZip(files: Record<string, Uint8Array>): Promise<Uint8Array> {
  const { zipSync } = await import('fflate');
  return zipSync(files);
}
