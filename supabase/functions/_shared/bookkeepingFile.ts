// Fetching a finished bookkeeping export, and getting movein.dat out of it.
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

/** The provider ships movein.dat inside a zip named for the moment it was built.
 *  The bookkeeper wants the .dat, so the archive is opened here rather than
 *  handed on: one file in, one file out, and nothing downstream has to know the
 *  transport was ever compressed. */
export function extractMovein(archive: Uint8Array): Uint8Array {
  const files = unzipSync(archive);
  const names = Object.keys(files);
  const name = names.find((n) => n.toLowerCase().endsWith('movein.dat')) ?? names[0];
  if (!name) throw new Error('the exported archive is empty');
  const bytes = files[name];
  if (!bytes || bytes.byteLength === 0) throw new Error('the exported file is empty');
  return bytes;
}

/** Where a garage's export lives. Foldered by garage, which is what the bucket's
 *  read policy matches on; the row id makes it unique and ties the object back
 *  to the row that owns it. */
export const exportPath = (garageId: string, exportId: string) =>
  `${garageId}/${exportId}/movein.dat`;

export const BUCKET = 'bookkeeping-exports';
