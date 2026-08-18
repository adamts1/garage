// bookkeeping-ready — the accounting provider calling back to say the export it
// was asked for is built.
//
//   POST /functions/v1/bookkeeping-ready/<token>
//   body: cid=...&url=https%3A%2F%2F...   (form encoded, despite asking for JSON)
//
// The second function here that runs WITHOUT a session, and for the same kind of
// reason as `photo`: the caller is not a person and holds nothing of ours. It is
// the provider's servers, which have no JWT and no account here. `verify_jwt =
// false` in config.toml is what allows that, so the token in the path carries
// the whole authorisation — 32 random bytes, one export, useless elsewhere.
//
// The token is doing a second job that is easy to miss. The order call returns
// `status: true` and no identifier at all, so there is nothing in this callback
// that could otherwise say which export it belongs to. The token IS the match.
// Nothing else in the request is trusted: not a garage, not a path, not an id.
//
// WHY IT DOWNLOADS RATHER THAN STORES THE LINK
//
// The link is a plain URL on the provider's side and is not authenticated —
// anybody holding it has a garage's books. So the file is pulled behind our own
// tenant isolation and the link is never handed to a browser.
//
// WHY A FAILURE HERE IS NOT AN ERROR
//
// "Ready" is optimistic: the file arrives on the other end some seconds after
// this call, and how many is not fixed. So a fetch that comes up empty leaves
// the export exactly as it was — still `requested`, with the reason on it — and
// the link is written down first so it can be tried again. Only a callback that
// carries no link at all is a dead end.
//
// service_role, because there is no caller to act as.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { BUCKET, exportPath, extractMovein, fetchExport } from '../_shared/bookkeepingFile.ts';

/** Hex, exactly what newToken() in export-bookkeeping produces. Anything else is
 *  not a token we ever issued, so it is rejected before it reaches the database. */
const TOKEN = /^[0-9a-f]{64}$/;

/* About ninety seconds in total, inside the function's own time limit. Long
   enough for every export seen so far; not long enough to be relied on, which
   is why failing here is retryable rather than final. */
const DELAYS_MS = [2000, 5000, 10000, 20000, 25000, 30000];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/* The callback's body, whatever the provider chose to send.
 *
 * The first version read `body.url` and nothing else, because that is what the
 * documentation describes. What actually arrives is form encoded — despite the
 * order asking for JSON — and the export failed with a field name as its only
 * clue. So the shape is no longer assumed: JSON if it parses, form encoding if
 * it does not, and then the whole tree is walked for the first string that
 * looks like a link. */
function parseBody(raw: string, contentType: string): unknown {
  const text = raw.trim();
  if (!text) return null;
  if (text.startsWith('{') || text.startsWith('[')) {
    try { return JSON.parse(text); } catch { /* fall through */ }
  }
  if (contentType.includes('form-urlencoded') || text.includes('=')) {
    try { return Object.fromEntries(new URLSearchParams(text)); } catch { /* fall through */ }
  }
  try { return JSON.parse(text); } catch { return text; }
}

/** The first http(s) string anywhere in the payload. Depth-limited so a
 *  pathological body cannot spin here. */
function findUrl(value: unknown, depth = 0): string | null {
  if (depth > 6) return null;
  if (typeof value === 'string') {
    return /^https?:\/\/\S+$/i.test(value.trim()) ? value.trim() : null;
  }
  if (Array.isArray(value)) {
    for (const v of value) {
      const found = findUrl(v, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (value && typeof value === 'object') {
    /* Named fields first, so a payload carrying both a download link and, say,
       a dashboard link cannot pick the wrong one by ordering alone. */
    const obj = value as Record<string, unknown>;
    for (const key of ['url', 'file_url', 'download_url', 'link', 'href']) {
      const found = typeof obj[key] === 'string' ? findUrl(obj[key], depth + 1) : null;
      if (found) return found;
    }
    for (const v of Object.values(obj)) {
      const found = findUrl(v, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

Deno.serve(async (req) => {
  try {
    const token = new URL(req.url).pathname.split('/').filter(Boolean).pop() ?? '';
    if (!TOKEN.test(token)) return json({ error: 'not found' }, 404);

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: row } = await admin
      .from('bookkeeping_exports')
      .select('id, garage_id, status')
      .eq('callback_token', token)
      .maybeSingle();
    /* Same answer as a malformed token, deliberately: a caller guessing tokens
       learns nothing from the difference between "no such export" and "not a
       token", and both are equally not their business. */
    if (!row) return json({ error: 'not found' }, 404);

    /* Already done. The provider may retry a callback it thinks failed, and a
       second download would at best overwrite a good file with a copy of
       itself. Answer 200 so it stops retrying. */
    if (row.status === 'ready') return json({ ok: true, already: true });

    const raw = await req.text().catch(() => '');
    const link = findUrl(parseBody(raw, req.headers.get('content-type') ?? ''));
    if (!link) {
      /* The payload itself, not a sentence about it. Whatever the provider sent
         is the only thing that can say why no link was found, and this is the
         one moment it exists. Truncated because an error column is not a log,
         and safe to show: a body with no link in it has no link to leak. */
      const seen = raw.slice(0, 500) || '(empty body)';
      await admin.from('bookkeeping_exports')
        .update({ status: 'error', error: `the callback carried no download link. it sent: ${seen}` })
        .eq('id', row.id);
      return json({ error: 'url required' }, 400);
    }

    /* Written down BEFORE anything is attempted with it. This is the only
       moment the link exists anywhere, and a fetch that runs ahead of the file
       must not take the pointer down with it — that is exactly how an export
       that was merely early became an export nobody could ever recover. */
    await admin.from('bookkeeping_exports').update({ source_url: link }).eq('id', row.id);

    const { bytes: archive, attempts } = await fetchExport(link, DELAYS_MS);
    if (!archive) {
      /* Still `requested`, not `error`. The file is very likely on its way, and
         the row now holds everything needed to go back for it. */
      await admin.from('bookkeeping_exports')
        .update({ error: `the file was not ready yet — ${attempts.join('; ')}` })
        .eq('id', row.id);
      return json({ ok: false, pending: true, attempts });
    }

    try {
      const bytes = extractMovein(archive);
      const path = exportPath(row.garage_id, row.id);
      const { error: upErr } = await admin.storage.from(BUCKET).upload(path, bytes, {
        contentType: 'application/octet-stream',
        upsert: true,
      });
      if (upErr) throw new Error(upErr.message);

      await admin.from('bookkeeping_exports').update({
        status: 'ready',
        storage_path: path,
        file_bytes: bytes.byteLength,
        ready_at: new Date().toISOString(),
        error: null,
      }).eq('id', row.id);

      return json({ ok: true });
    } catch (e) {
      /* The file arrived and we could not make sense of it. That IS final —
         retrying would fetch the same bytes and fail the same way. */
      const message = e instanceof Error ? e.message : String(e);
      await admin.from('bookkeeping_exports')
        .update({ status: 'error', error: message })
        .eq('id', row.id);
      /* 200: the provider did its part, and a 5xx would earn us retries of a
         callback that is not going to go better. */
      return json({ ok: false, error: message });
    }
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
