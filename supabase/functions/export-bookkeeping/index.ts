// export-bookkeeping — orders the accountant's file from the garage's accounting
// provider: a range of the books in the format their software imports, which for
// חשבשבת is movein.dat.
//
// It runs server-side for the usual reason — the provider credentials live in
// garage_billing_secrets and no client may read them — and for one more that is
// specific to this job: it has to mint the callback secret and write it down
// before the order goes out. A client that generated its own would be naming the
// authorisation for a public endpoint.
//
// Authorization is RLS on the way in (the caller's JWT decides which garage they
// are asking for) and service_role for the credential read and the row write.
//
// WHAT THIS RETURNS IS NOT A FILE. The provider builds the export in the
// background and announces it later by calling bookkeeping-ready. This resolves
// as soon as the order is accepted, and the row it created is what the UI
// watches.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { BUCKET, exportPath, extractMovein, fetchExport } from '../_shared/bookkeepingFile.ts';
import { icountAdapter } from '../_shared/icount.ts';
import type { InvoiceProvider, ProviderCredentials } from '../_shared/provider.ts';

const ADAPTERS: Record<string, InvoiceProvider> = { icount: icountAdapter };

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The callback's whole authorisation, so it is generated the way a key is and
 *  not the way an id is: 32 bytes from the platform CSPRNG, hex. Nothing about
 *  the export is recoverable from it. */
function newToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader) return json({ error: 'unauthorized' }, 401);

    const url = Deno.env.get('SUPABASE_URL')!;
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
    const admin = createClient(url, serviceKey);

    const body = await req.json().catch(() => ({}));

    /* ---- retry: go back for a file the callback ran ahead of ----
       Not a new export. The provider already built one and told us where it
       would be; the callback simply asked too early, which it can, because how
       long the file takes is not fixed. The link was written down for exactly
       this, and the row is found through the caller's own JWT so a retry can
       only ever be for their own garage. */
    if (body.retry) {
      const { data: mine, error: mErr } = await userClient
        .from('bookkeeping_exports')
        .select('id')
        .eq('id', String(body.retry))
        .maybeSingle();
      if (mErr) return json({ error: mErr.message }, 400);
      if (!mine) return json({ error: 'export not found in your garage' }, 404);

      /* source_url is not readable by a client, by design — read it here. */
      const { data: row } = await admin
        .from('bookkeeping_exports')
        .select('id, garage_id, status, source_url')
        .eq('id', mine.id)
        .single();
      if (row.status === 'ready') return json({ export_id: row.id, already: true });
      if (!row.source_url) {
        return json({ error: 'the provider has not called back for this export yet' }, 409);
      }

      /* One quick pass. The slow, patient schedule belongs to the callback; by
         the time somebody is pressing a button the file has either appeared or
         something else is wrong, and making them wait ninety seconds to find
         out which is not a kindness. */
      const { bytes: archive, attempts } = await fetchExport(row.source_url, [0, 3000]);
      if (!archive) {
        await admin.from('bookkeeping_exports')
          .update({ error: `still not ready — ${attempts.join('; ')}` })
          .eq('id', row.id);
        return json({ error: 'the file is still not ready — try again in a minute', attempts }, 409);
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
        return json({ export_id: row.id, ready: true });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        await admin.from('bookkeeping_exports')
          .update({ status: 'error', error: message })
          .eq('id', row.id);
        return json({ error: message }, 502);
      }
    }

    const startDate = String(body.start_date ?? '');
    const endDate = String(body.end_date ?? '');
    if (!DATE.test(startDate) || !DATE.test(endDate)) {
      return json({ error: 'start_date and end_date are required, as YYYY-MM-DD' }, 400);
    }
    /* Checked here as well as by the table's constraint. A backwards range comes
       back from the provider as an empty file rather than an error — the one
       failure that looks like a success — so it is worth refusing twice. */
    if (endDate < startDate) return json({ error: 'end_date is before start_date' }, 400);

    /* Absent means include it. The export is for a bookkeeper, and the default
       that is safe for them is everything. */
    const flag = (v: unknown) => v === undefined || v === null || v === true;
    const docs = flag(body.export_docs);
    const expenses = flag(body.export_expenses);
    const clients = flag(body.export_clients);
    const suppliers = flag(body.export_suppliers);
    if (!docs && !expenses && !clients && !suppliers) {
      return json({ error: 'nothing selected to export' }, 400);
    }

    /* Whose books these are, asked of the caller's own JWT. This is the only
       place the garage is decided — everything downstream uses what comes back
       here, so a caller cannot name a garage they are not in. */
    const { data: garageId, error: gErr } = await userClient.rpc('current_garage_id');
    if (gErr) return json({ error: gErr.message }, 400);
    if (!garageId) return json({ error: 'no garage for this user' }, 403);

    const { data: cfg } = await admin.from('garage_billing').select('provider, active').eq('garage_id', garageId).maybeSingle();
    if (!cfg || !cfg.active) return json({ error: 'accounting is not configured for this garage' }, 400);
    const adapter = ADAPTERS[cfg.provider];
    if (!adapter) return json({ error: `unknown provider: ${cfg.provider}` }, 400);
    const { data: sec } = await admin.from('garage_billing_secrets').select('credentials').eq('garage_id', garageId).maybeSingle();
    if (!sec?.credentials) return json({ error: 'accounting credentials missing for this garage' }, 400);
    const credentials = sec.credentials as ProviderCredentials;

    const { data: { user } } = await userClient.auth.getUser();

    /* The row FIRST, and the order second. If the order fails the row is deleted
       below; if the order succeeds and the row were missing, the callback would
       arrive with a token matching nothing and a finished export would be lost
       with no way to ask for it again. Of the two, an orphan row is the cheaper
       mistake. */
    const callbackToken = newToken();
    const { data: row, error: iErr } = await admin.from('bookkeeping_exports').insert({
      garage_id: garageId,
      start_date: startDate,
      end_date: endDate,
      export_docs: docs,
      export_expenses: expenses,
      export_clients: clients,
      export_suppliers: suppliers,
      provider: cfg.provider,
      callback_token: callbackToken,
      requested_by: user?.id ?? null,
    }).select('id, start_date, end_date, status, created_at').single();
    if (iErr) return json({ error: iErr.message }, 500);

    try {
      await adapter.exportBookkeeping({
        credentials,
        format: 'hash_dos_long',
        startDate,
        endDate,
        docs,
        expenses,
        clients,
        suppliers,
        /* The secret rides in the path, not a query string: query strings are
           the part of a URL that gets logged by proxies and written into
           analytics, and this one is a credential. */
        webhookUrl: `${url}/functions/v1/bookkeeping-ready/${callbackToken}`,
      });
    } catch (e) {
      /* Nothing was ordered, so nothing will ever call back. Leaving the row
         would put an export on the screen that is permanently "being prepared",
         which is worse than the error the caller is about to be shown. */
      await admin.from('bookkeeping_exports').delete().eq('id', row.id);
      return json({ error: e instanceof Error ? e.message : String(e) }, 502);
    }

    return json({ export: row });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
