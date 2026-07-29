// record-expense — pushes a natively-recorded supplier expense into the garage's
// accounting provider so it reaches the accountant's books / input-VAT, then
// writes the provider ids back onto our rows.
//
// It runs server-side because it needs the provider credentials (which no client
// may read) and because it may create the supplier in the provider and must
// persist that supplier id back for reuse.
//
// Like issue-invoice: the CALLER'S JWT reads the expense (RLS is the
// authorization boundary — they can only sync their own garage's expense), and
// the service_role client does the write-backs and the credential read. It is
// provider-agnostic via the same ADAPTERS registry.
//
// A provider-side failure is NOT an error the caller must handle: the native
// record already exists. We store sync_status='error' with the message and
// return the row (200) so the UI can show "not synced — retry". Only a missing
// expense or missing credentials is a hard 4xx.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
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
    const expenseId = body.expense_id as string;
    if (!expenseId) return json({ error: 'expense_id required' }, 400);

    // Caller's JWT -> RLS: their own garage's expense, with its supplier joined.
    const { data: exp, error: eErr } = await userClient
      .from('supplier_expenses')
      .select('*, suppliers(id, name, tax_id, email, phone, provider_supplier_id)')
      .eq('id', expenseId)
      .maybeSingle();
    if (eErr) return json({ error: eErr.message }, 400);
    if (!exp) return json({ error: 'expense not found in your garage' }, 404);

    // Idempotent: an already-synced expense must not be pushed twice — expense/create
    // is not idempotent and would duplicate it in the provider's books.
    if (exp.sync_status === 'synced' && exp.provider_expense_id) {
      const { data: current } = await admin.from('supplier_expenses').select('*, suppliers(name)').eq('id', exp.id).single();
      return json({ expense: current, reused: true });
    }

    // provider + credentials for the garage (service_role only).
    const { data: cfg } = await admin.from('garage_billing').select('provider, active').eq('garage_id', exp.garage_id).maybeSingle();
    if (!cfg || !cfg.active) return json({ error: 'invoicing/accounting is not configured for this garage' }, 400);
    const adapter = ADAPTERS[cfg.provider];
    if (!adapter) return json({ error: `unknown provider: ${cfg.provider}` }, 400);
    const { data: sec } = await admin.from('garage_billing_secrets').select('credentials').eq('garage_id', exp.garage_id).maybeSingle();
    if (!sec?.credentials) return json({ error: 'accounting credentials missing for this garage' }, 400);
    const credentials = sec.credentials as ProviderCredentials;

    const supplier = exp.suppliers ?? {};
    // iCount requires a document number; fall back to a stable per-expense token.
    const docnum = (exp.reference && String(exp.reference).trim()) || `EXP-${String(exp.id).slice(0, 8)}`;

    try {
      const result = await adapter.recordExpense({
        credentials,
        supplier: {
          name: supplier.name || 'ספק',
          taxId: supplier.tax_id || undefined,
          email: supplier.email || undefined,
          phone: supplier.phone || undefined,
          providerSupplierId: supplier.provider_supplier_id || null,
        },
        category: exp.category ?? null,
        date: exp.expense_date,
        docnum,
        subtotal: Number(exp.subtotal),
        vat: Number(exp.vat),
        description: exp.description || undefined,
      });

      // Persist the provider supplier id for reuse (only if newly created).
      if (!supplier.provider_supplier_id && supplier.id) {
        await admin.from('suppliers').update({ provider_supplier_id: result.providerSupplierId }).eq('id', supplier.id);
      }

      const { data: updated } = await admin.from('supplier_expenses')
        .update({ provider_expense_id: result.providerExpenseId, sync_status: 'synced', sync_error: null })
        .eq('id', exp.id).select('*, suppliers(name)').single();
      return json({ expense: updated });
    } catch (syncErr) {
      // Provider rejected it — keep the native record, mark it and report back.
      const message = syncErr instanceof Error ? syncErr.message : String(syncErr);
      const { data: updated } = await admin.from('supplier_expenses')
        .update({ sync_status: 'error', sync_error: message })
        .eq('id', exp.id).select('*, suppliers(name)').single();
      return json({ expense: updated });
    }
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
