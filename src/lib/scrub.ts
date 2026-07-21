/* URL scrubbing for telemetry.

   Kept dependency-free and separate from sentry.ts so it can be tested
   directly — this is the code standing between customer PII and a third
   party, so it should be the best-tested thing in the repo.

   PostgREST puts filters in the query string. `.eq('name', 'יוסי לוי')`
   becomes `?name=eq.%D7%99%D7%95%D7%A1%D7%99...`, and Sentry records fetch
   breadcrumbs with full URLs. Unscrubbed, every customer lookup would leave
   the browser. */

/** Params that describe the shape of a query, never its values. */
const SAFE_PARAMS = new Set(['select', 'order', 'limit', 'offset', 'apikey']);

/**
 * Keep the path and the parameter names; redact every value that could carry
 * PII. Deliberately an allowlist: a new PostgREST filter we have not thought
 * of gets redacted by default rather than leaked by default.
 */
export const scrubUrl = (raw: string): string => {
  if (!raw) return raw;
  try {
    const absolute = /^[a-z][a-z0-9+.-]*:/i.test(raw);
    const u = new URL(raw, 'http://placeholder.invalid');

    let touched = false;
    for (const key of [...u.searchParams.keys()]) {
      if (SAFE_PARAMS.has(key)) continue;
      u.searchParams.set(key, '<redacted>');
      touched = true;
    }
    if (!touched) return raw;

    // searchParams re-encodes; decode the marker back so it stays readable.
    const search = u.search.replace(/%3Credacted%3E/gi, '<redacted>');
    return absolute ? u.origin + u.pathname + search : u.pathname + search;
  } catch {
    // Unparseable — drop the query string wholesale rather than guess.
    return raw.split('?')[0];
  }
};
