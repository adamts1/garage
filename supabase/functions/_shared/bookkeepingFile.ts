// Fetching a finished bookkeeping export, and getting the requested files out of it.
//
// Shared because two functions need it: the callback, which tries as soon as the
// provider says the file is coming, and the retry, which tries again later when
// that turned out to be too soon.
//
// TWO THINGS MAKE THIS HARDER THAN A GET, and both were found the hard way.
//
// 1. THE FILE IS NOT THERE YET. The callback runs ahead of the file — measured
//    at more than fifteen seconds, and no reason to think that is fixed, since
//    a year of books is a bigger export than a month of them. So this waits,
//    and asks again, and reports how many times it asked.
//
// 2. A MISS IS CACHED FOR A YEAR. The 404 comes back through Cloudflare with
//    `cache-control: max-age=31536000`, so the first early request poisons that
//    exact URL: every later attempt is served the cached 404 while the file sits
//    there perfectly readable. `cf-cache-status: HIT` on a request for a file
//    that exists is what gave it away — the same URL with a junk query
//    parameter returned the zip immediately.
//
//    So every request here carries a unique parameter. It can neither read a
//    poisoned entry nor create one against the bare URL, which matters because
//    the bare URL is the one a person would try by hand.

import { unzipSync } from 'https://esm.sh/fflate@0.8.2';

/** A movein.dat for a quarter is measured in kilobytes. Far above any real one,
 *  far below anything that could exhaust the function — it is here so a wrong
 *  link cannot make us download something enormous. */
export const MAX_BYTES = 32 * 1024 * 1024;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* Unique per attempt AND per call: two functions may be trying the same URL,
   and a shared cache key would let one read the other's miss. */
const bust = (link: string, n: number) =>
  `${link}${link.includes('?') ? '&' : '?'}_=${Date.now()}-${n}-${Math.floor(Math.random() * 1e6)}`;

export interface FetchResult {
  bytes: Uint8Array | null;
  /** What was tried, in order. Goes on the row when it did not work — an export
   *  that failed is a thing somebody has to act on, and the attempts are the
   *  only thing that says whether to wait longer or to look elsewhere. */
  attempts: string[];
}

/** Tries the link on the given schedule. Returns the bytes, or every attempt it
 *  made. Never throws for a 404: being early is the expected case here. */
export async function fetchExport(link: string, delaysMs: readonly number[]): Promise<FetchResult> {
  const attempts: string[] = [];

  for (let i = 0; i < delaysMs.length; i++) {
    await sleep(delaysMs[i]);
    const res = await fetch(bust(link, i), { headers: { 'Cache-Control': 'no-cache' } })
      .catch((e) => e as Error);

    if (res instanceof Response && res.ok) {
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.byteLength > MAX_BYTES) {
        attempts.push(`try ${i + 1}: ${bytes.byteLength} bytes, refused as implausible`);
        return { bytes: null, attempts };
      }
      return { bytes, attempts };
    }
    attempts.push(res instanceof Response ? `try ${i + 1}: ${res.status}` : `try ${i + 1}: ${res.message}`);
  }

  return { bytes: null, attempts };
}

/** The files a person can ask for. Anything else in the provider's archive —
 *  movein.doc, movein.prm — is ignored on purpose. */
export const FILE_NAMES = ['movein.dat', 'heshin.dat', 'heshin.prm'] as const;
export type FileName = typeof FILE_NAMES[number];

/** Takes exactly the named files out of the provider's archive.
 *
 *  Strict on purpose. Every named file must be there, under that exact name, and
 *  not be empty — otherwise this throws and nothing is stored. The first version
 *  fell back to "whatever is first in the zip" when movein.dat was missing,
 *  which with a different export type would have handed the bookkeeper a
 *  movein.doc renamed to movein.dat. A wrong file that looks right is the one
 *  failure this must never produce. */
export function extractFiles(archive: Uint8Array, names: readonly string[]): Record<string, Uint8Array> {
  const files = unzipSync(archive);
  const entries = Object.keys(files);
  const out: Record<string, Uint8Array> = {};
  for (const name of names) {
    const entry = entries.find((e) => e.split('/').pop()!.toLowerCase() === name);
    if (!entry) {
      throw new Error(`${name} is missing from the provider's archive (it contained: ${entries.join(', ') || 'nothing'})`);
    }
    if (!files[entry] || files[entry].byteLength === 0) {
      throw new Error(`${name} arrived empty`);
    }
    out[name] = files[entry];
  }
  return out;
}

/** Where a garage's export file lives. Foldered by garage, which is what the
 *  bucket's read policy matches on; the export id makes it unique. The default
 *  is the path every export used before there was a choice of files, so old
 *  rows and new ones resolve the same way. */
export const exportPath = (garageId: string, exportId: string, name: string = 'movein.dat') =>
  `${garageId}/${exportId}/${name}`;

export const BUCKET = 'bookkeeping-exports';

/* What came of one attempt to collect a part's files. */
export type Delivery =
  | { kind: 'stored'; sizes: Record<string, number> }
  /* The file was not there yet. Retryable — the link is already saved. */
  | { kind: 'pending'; attempts: string[] }
  /* The file arrived and is wrong, or could not be stored. Retrying would
     fetch the same bytes, so this is final. */
  | { kind: 'failed'; message: string };

/** Downloads one archive, takes the named files out of it, and stores each of
 *  them. Nothing is recorded in the database here — the caller does that, so the
 *  callback and the retry decide the outcome the same way. */
export async function deliver(
  // deno-lint-ignore no-explicit-any
  admin: any,
  opts: { link: string; garageId: string; exportId: string; names: readonly string[]; delaysMs: readonly number[] },
): Promise<Delivery> {
  const { bytes: archive, attempts } = await fetchExport(opts.link, opts.delaysMs);
  if (!archive) return { kind: 'pending', attempts };

  try {
    const files = extractFiles(archive, opts.names);
    const sizes: Record<string, number> = {};
    for (const [name, bytes] of Object.entries(files)) {
      const { error } = await admin.storage.from(BUCKET).upload(
        exportPath(opts.garageId, opts.exportId, name),
        bytes,
        { contentType: 'application/octet-stream', upsert: true },
      );
      if (error) throw new Error(`could not store ${name}: ${error.message}`);
      sizes[name] = bytes.byteLength;
    }
    return { kind: 'stored', sizes };
  } catch (e) {
    return { kind: 'failed', message: e instanceof Error ? e.message : String(e) };
  }
}
