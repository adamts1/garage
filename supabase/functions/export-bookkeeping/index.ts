// export-bookkeeping — orders the accountant's files from the garage's
// accounting provider, for a range of dates.
//
//   POST { start_date, end_date, files: ['movein.dat', 'heshin.dat', 'heshin.prm'] }
//   POST { retry: <export id> }
//
// THE FLOW, START TO END
//
//   1. The person ticks which of the three files they want.
//   2. This function reads which software the garage's bookkeeper uses
//      (garage_billing.bookkeeping_software) and works out the orders that
//      takes (bookkeepingParts.ts):
//        ריווחית -> one order:  rivhit + export_cards           (all three files)
//        חשבשבת  -> two orders: hash_dos_long                   (movein.dat)
//                               hash_win_flexible + export_cards (heshin.*)
//      An order is only sent if one of its files was ticked. A garage with no
//      software set cannot export at all — it is refused, never guessed.
//   3. It writes the export row and one PART row per order, each part with its
//      own secret callback token — and only then sends the orders.
//   4. The provider builds each archive in the background and calls
//      bookkeeping-ready once per order, minutes later.
//   5. bookkeeping-ready downloads that archive, keeps only the ticked files,
//      stores them, and marks the part ready. When every part is ready, the
//      export is ready, and the page shows a download button per file.
//
// It runs server-side for the usual reason — the provider credentials live in
// garage_billing_secrets and no client may read them — and because it mints the
// callback secrets, which a client must never name for itself.
//
// WHAT THIS RETURNS IS NOT A FILE. It resolves as soon as the orders are
// accepted; the row it created is what the page watches.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { deliver, FILE_NAMES, type FileName } from '../_shared/bookkeepingFile.ts';
import { isSoftware, planParts, settlePart, type PartRow } from '../_shared/bookkeepingParts.ts';
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
 *  not the way an id is: 32 bytes from the platform CSPRNG, hex. */
function newToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The files asked for, validated. Absent means movein.dat alone — what every
 *  export was before there was a choice, so a page loaded before this deploy
 *  keeps getting exactly what it always got. */
function readFiles(raw: unknown): FileName[] | string {
  if (raw === undefined || raw === null) return ['movein.dat'];
  if (!Array.isArray(raw)) return 'files must be a list';
  const unknown = raw.filter((f) => !FILE_NAMES.includes(f));
  if (unknown.length) return `unknown file: ${unknown.join(', ')}`;
  /* Kept in the fixed order, so the same choice is always stored the same way. */
  const files = FILE_NAMES.filter((f) => raw.includes(f));
  if (!files.length) return 'nothing selected to export';
  return files;
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

    /* ---- retry: go back for files the callback ran ahead of ----
       Nothing is re-ordered. The provider already built the archive and said
       where; the callback simply asked too early. The export is found through
       the caller's own JWT, so a retry can only ever touch their own garage. */
    if (body.retry) {
      const { data: mine, error: mErr } = await userClient
        .from('bookkeeping_exports')
        .select('id')
        .eq('id', String(body.retry))
        .maybeSingle();
      if (mErr) return json({ error: mErr.message }, 400);
      if (!mine) return json({ error: 'export not found in your garage' }, 404);

      const { data: row } = await admin
        .from('bookkeeping_exports')
        .select('id, garage_id, status, source_url')
        .eq('id', mine.id)
        .single();
      if (!row) return json({ error: 'export not found in your garage' }, 404);
      if (row.status === 'ready') return json({ export_id: row.id, already: true });
      if (row.status === 'error') return json({ error: 'this export failed — order a new one' }, 409);

      const { data: parts } = await admin
        .from('bookkeeping_export_parts')
        .select('id, export_id, garage_id, kind, files, status, source_url')
        .eq('export_id', row.id);

      /* An export ordered before parts existed: one movein.dat, link on the row. */
      if (!parts?.length) {
        if (!row.source_url) return json({ error: 'the provider has not called back for this export yet' }, 409);
        const delivery = await deliver(admin, {
          link: row.source_url, garageId: row.garage_id, exportId: row.id,
          names: ['movein.dat'], delaysMs: [0, 3000],
        });
        if (delivery.kind === 'pending') {
          await admin.from('bookkeeping_exports')
            .update({ error: `still not ready — ${delivery.attempts.join('; ')}` }).eq('id', row.id);
          return json({ error: 'the file is still not ready — try again in a minute' }, 409);
        }
        if (delivery.kind === 'failed') {
          await admin.from('bookkeeping_exports').update({ status: 'error', error: delivery.message }).eq('id', row.id);
          return json({ error: delivery.message }, 502);
        }
        await admin.from('bookkeeping_exports').update({
          status: 'ready',
          storage_path: `${row.garage_id}/${row.id}/movein.dat`,
          file_sizes: delivery.sizes,
          file_bytes: delivery.sizes['movein.dat'],
          ready_at: new Date().toISOString(),
          error: null,
        }).eq('id', row.id);
        return json({ export_id: row.id, ready: true });
      }

      /* Only parts that are still waiting AND whose callback has come. One
         quick pass each: by the time somebody presses a button the file has
         either appeared or something else is wrong. */
      const due = parts.filter((p) => p.status === 'requested' && p.source_url);
      if (!due.length) {
        return json({ error: 'the provider has not called back for this export yet — try again in a minute' }, 409);
      }
      let status = row.status;
      for (const p of due) {
        const delivery = await deliver(admin, {
          link: p.source_url, garageId: p.garage_id, exportId: p.export_id,
          names: p.files, delaysMs: [0, 3000],
        });
        status = await settlePart(admin, p as PartRow, delivery);
        if (status === 'error') break;
      }
      if (status === 'ready') return json({ export_id: row.id, ready: true });
      if (status === 'error') return json({ error: 'the export failed — see the reason in the list' }, 502);
      return json({ error: 'not all files are ready yet — try again in a minute' }, 409);
    }

    /* ---- a new export ---- */

    const startDate = String(body.start_date ?? '');
    const endDate = String(body.end_date ?? '');
    if (!DATE.test(startDate) || !DATE.test(endDate)) {
      return json({ error: 'start_date and end_date are required, as YYYY-MM-DD' }, 400);
    }
    /* A backwards range comes back from the provider as an empty file rather
       than an error — the one failure that looks like a success. */
    if (endDate < startDate) return json({ error: 'end_date is before start_date' }, 400);

    const files = readFiles(body.files);
    if (typeof files === 'string') return json({ error: files }, 400);

    /* What goes INTO the books. Absent means include it — the default that is
       safe for a bookkeeper is everything. The page no longer offers these; they
       are honoured for a page loaded before this deploy. */
    const flag = (v: unknown) => v === undefined || v === null || v === true;
    const docs = flag(body.export_docs);
    const expenses = flag(body.export_expenses);
    const clients = flag(body.export_clients);
    const suppliers = flag(body.export_suppliers);
    if (!docs && !expenses && !clients && !suppliers) {
      return json({ error: 'nothing selected to export' }, 400);
    }

    /* Whose books these are, asked of the caller's own JWT. The only place the
       garage is decided. */
    const { data: garageId, error: gErr } = await userClient.rpc('current_garage_id');
    if (gErr) return json({ error: gErr.message }, 400);
    if (!garageId) return json({ error: 'no garage for this user' }, 403);

    const { data: cfg } = await admin.from('garage_billing')
      .select('provider, active, bookkeeping_software').eq('garage_id', garageId).maybeSingle();
    if (!cfg || !cfg.active) return json({ error: 'accounting is not configured for this garage' }, 400);
    /* Never guessed. The two softwares need different files, and the wrong one
       imports without complaint. */
    const software = cfg.bookkeeping_software;
    if (!isSoftware(software)) {
      return json({ error: "the garage's bookkeeping software (ריווחית / חשבשבת) is not set — ask support to set it" }, 400);
    }
    const parts = planParts(software, files);
    const adapter = ADAPTERS[cfg.provider];
    if (!adapter) return json({ error: `unknown provider: ${cfg.provider}` }, 400);
    const { data: sec } = await admin.from('garage_billing_secrets').select('credentials').eq('garage_id', garageId).maybeSingle();
    if (!sec?.credentials) return json({ error: 'accounting credentials missing for this garage' }, 400);
    const credentials = sec.credentials as ProviderCredentials;

    const { data: { user } } = await userClient.auth.getUser();

    /* The rows FIRST, the orders second. A callback that arrives for a token we
       never wrote down would be a finished export lost with no way to ask for it
       again; an orphan row is the cheaper mistake, and is cleaned up below. */
    const { data: row, error: iErr } = await admin.from('bookkeeping_exports').insert({
      garage_id: garageId,
      start_date: startDate,
      end_date: endDate,
      files,
      software,
      export_docs: docs,
      export_expenses: expenses,
      export_clients: clients,
      export_suppliers: suppliers,
      provider: cfg.provider,
      format: parts.map((p) => p.plan.format).join('+'),
      requested_by: user?.id ?? null,
    }).select('id, start_date, end_date, status, created_at, files, software').single();
    if (iErr || !row) return json({ error: iErr?.message ?? 'could not record the export' }, 500);

    const partRows = parts.map((p) => ({
      export_id: row.id,
      garage_id: garageId,
      kind: p.plan.kind,
      format: p.plan.format,
      files: p.files,
      callback_token: newToken(),
    }));
    const { data: inserted, error: pErr } = await admin.from('bookkeeping_export_parts')
      .insert(partRows).select('id, kind, callback_token');
    if (pErr || !inserted) {
      await admin.from('bookkeeping_exports').delete().eq('id', row.id);
      return json({ error: pErr?.message ?? 'could not record the order' }, 500);
    }

    /* One order per part, in turn. If one is refused, the rest are NOT sent:
       the export has already failed, and a second order would only make the
       provider build files nobody will use. Those parts are marked failed too,
       so a late callback for anything is ignored. */
    const failures: string[] = [];
    let ordered = 0;
    for (const p of parts) {
      const part = inserted.find((r: { kind: string }) => r.kind === p.plan.kind)!;
      if (failures.length) {
        await admin.rpc('bookkeeping_part_failed', {
          p_part: part.id,
          p_error: `${p.files.join(' / ')}: not ordered, because another part of this export was refused`,
        });
        continue;
      }
      try {
        await adapter.exportBookkeeping({
          credentials,
          format: p.plan.format,
          startDate,
          endDate,
          docs,
          expenses,
          clients,
          suppliers,
          cards: p.plan.cards,
          /* The secret rides in the path, not a query string: query strings get
             logged by proxies, and this one is a credential. */
          webhookUrl: `${url}/functions/v1/bookkeeping-ready/${part.callback_token}`,
        });
        ordered++;
      } catch (e) {
        const message = `${p.files.join(' / ')}: the order was refused — ${e instanceof Error ? e.message : String(e)}`;
        failures.push(message);
        await admin.rpc('bookkeeping_part_failed', { p_part: part.id, p_error: message });
      }
    }

    /* Nothing was ordered, so nothing will ever call back. Leaving the row
       would show an export that failed for no visible reason; the person is
       shown the error instead. */
    if (ordered === 0) {
      await admin.from('bookkeeping_exports').delete().eq('id', row.id);
      return json({ error: failures.join(' | ') }, 502);
    }
    /* Some of it was ordered before something was refused. The row stays — as a
       failed export, with the reason on it — and the person is told to order
       again. Never a partial set presented as complete. */
    if (failures.length) return json({ error: failures.join(' | ') }, 502);

    return json({ export: row });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
