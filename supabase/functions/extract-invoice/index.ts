// extract-invoice — reads the pages of a scanned supplier invoice.
//
//   POST { scan_id }  ->  { scan_id, extraction, supplier, duplicate_of, model }
//
// The app has already inserted the expense_scans row and uploaded its pages to
// expense-scans/{garage_id}/{scan_id}/page-{n}.jpg. This reads them, asks the
// model (_shared/extractInvoice.ts), writes the result onto the row, and adds
// the two things only the server can answer cheaply: which of the garage's
// suppliers this is, and whether that supplier's invoice number is already on
// file. The checks a person reviews against (line arithmetic, totals, VAT, the
// tax-id check digit) are the app's, in @garage/shared — they have to re-run on
// every edit anyway.
//
// Like record-expense: the CALLER'S JWT reads the scan, so RLS decides whose it
// is, and service_role reads the images and writes the result, which the client
// may not. The caller names a scan, never a path: the paths are derived from the
// row, so no input reaches another garage's folder.
//
// Idempotent. A scan already extracted answers from the row without calling the
// model again — the processing screen's retry, a second tap, a dropped response
// all cost nothing. `force: true` reads it again.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { ExtractionError, extractInvoice, type InvoiceExtraction } from '../_shared/extractInvoice.ts';

const BUCKET = 'expense-scans';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const digits = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '') || null;

/** A supplier's name as compared: no company suffix, quotes, punctuation or
 *  spacing — "א.ב. חלקי רכב בע״מ" and "אב חלקי רכב" are one supplier. */
const nameKey = (s: string | null | undefined) =>
  (s ?? '')
    .replace(/בע["״'׳]?מ/g, '')
    .replace(/[^\p{L}\p{N}]/gu, '')
    .toLowerCase();

interface SupplierRow { id: string; name: string; tax_id: string | null }

/** By tax id when there is one — that is what identifies a business. By name
 *  only when the invoice gave no tax id, and then it is a suggestion the person
 *  confirms (`by: 'name'`). */
function matchSupplier(rows: SupplierRow[], ex: InvoiceExtraction) {
  const tax = digits(ex.supplier_tax_id);
  if (tax) {
    const hit = rows.find((r) => digits(r.tax_id) === tax);
    if (hit) return { id: hit.id, name: hit.name, tax_id: hit.tax_id, by: 'tax_id' as const };
  }
  const key = nameKey(ex.supplier_name);
  if (!tax && key.length >= 3) {
    const hit = rows.find((r) => nameKey(r.name) === key)
      ?? rows.find((r) => { const k = nameKey(r.name); return k.length >= 3 && (k.includes(key) || key.includes(k)); });
    if (hit) return { id: hit.id, name: hit.name, tax_id: hit.tax_id, by: 'name' as const };
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader) return json({ error: 'unauthorized' }, 401);

    const url = Deno.env.get('SUPABASE_URL')!;
    const userClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const body = await req.json().catch(() => ({}));
    const scanId = typeof body.scan_id === 'string' ? body.scan_id : '';
    if (!scanId) return json({ error: 'scan_id required' }, 400);

    // Caller's JWT -> RLS: a scan of their own garage, or nothing.
    const { data: scan, error: sErr } = await userClient
      .from('expense_scans')
      .select('id, garage_id, status, page_count, result, model')
      .eq('id', scanId)
      .maybeSingle();
    if (sErr) return json({ error: sErr.message }, 400);
    if (!scan) return json({ error: 'scan not found in your garage' }, 404);
    if (scan.status === 'saved') return json({ error: 'this scan is already saved' }, 409);

    let extraction: InvoiceExtraction;
    let model: string = scan.model ?? '';
    if (scan.status === 'extracted' && scan.result && !body.force) {
      extraction = scan.result as InvoiceExtraction;
    } else {
      const pages: Uint8Array[] = [];
      for (let n = 1; n <= scan.page_count; n++) {
        const { data: blob, error } = await admin.storage
          .from(BUCKET)
          .download(`${scan.garage_id}/${scan.id}/page-${n}.jpg`);
        if (error || !blob) {
          return json({ error: `page ${n} has not been uploaded`, code: 'pages_missing' }, 409);
        }
        pages.push(new Uint8Array(await blob.arrayBuffer()));
      }

      try {
        const run = await extractInvoice(pages);
        extraction = run.extraction;
        model = run.model;
        await admin.from('expense_scans').update({
          status: 'extracted', result: run.extraction, model: run.model, error: null,
          duration_ms: run.ms, input_tokens: run.inputTokens, output_tokens: run.outputTokens,
          extracted_at: new Date().toISOString(),
        }).eq('id', scan.id);
        console.log(JSON.stringify({
          fn: 'extract-invoice', scan: scan.id, pages: scan.page_count, model: run.model,
          ms: run.ms, input_tokens: run.inputTokens, output_tokens: run.outputTokens,
          lines: run.extraction.lines?.length ?? 0,
        }));
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        await admin.from('expense_scans').update({ status: 'failed', error: message }).eq('id', scan.id);
        console.error(JSON.stringify({ fn: 'extract-invoice', scan: scan.id, error: message }));
        if (e instanceof ExtractionError) {
          return json({ error: message, code: 'extraction_failed', retryable: e.retryable }, 502);
        }
        throw e;
      }
    }

    // Through the caller's JWT again: their garage's suppliers and expenses only.
    const { data: suppliers } = await userClient.from('suppliers').select('id, name, tax_id');
    const supplier = matchSupplier((suppliers ?? []) as SupplierRow[], extraction);

    let duplicateOf: string | null = null;
    const reference = extraction.invoice_number?.trim();
    if (supplier && reference) {
      const { data: dup } = await userClient
        .from('supplier_expenses')
        .select('id')
        .eq('supplier_id', supplier.id)
        .ilike('reference', reference.replace(/[%_\\]/g, '\\$&'))
        .limit(1)
        .maybeSingle();
      duplicateOf = dup?.id ?? null;
    }

    return json({ scan_id: scan.id, extraction, supplier, duplicate_of: duplicateOf, model });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
