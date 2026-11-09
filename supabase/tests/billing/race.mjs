#!/usr/bin/env node
/* issue-invoice end to end: overlapping calls create one document, and an
 * answer the provider never gave is never guessed. Local only.
 *
 *   npx supabase start
 *   node supabase/tests/billing/fake-icount.mjs &
 *   echo 'ICOUNT_BASE_URL=http://host.docker.internal:8787/api/v3.php' > /tmp/billing.env
 *   npx supabase functions serve issue-invoice --env-file /tmp/billing.env &
 *   SUPABASE_ANON_KEY=… SUPABASE_SERVICE_ROLE_KEY=… node supabase/tests/billing/race.mjs
 *
 * Keys from {"linked_project":null,"_tag":"Error","error":{"code":"StatusDbInspectError","message":"failed to inspect container health: Error response from daemon: No such container: supabase_db_e2e"}}. The fake stands in for iCount and counts the
 * documents it was asked to create — that count is what every check is about.
 * Against the function as it was before 20261109090000, A, B, C, E and F fail:
 * each overlapping pair created two documents and stored one. */
import { createClient } from '@supabase/supabase-js';

const API = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY, ANON = process.env.SUPABASE_ANON_KEY;
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(API)) {
  console.error(`Refusing to run against ${API}: this test creates garages and documents. Local only.`);
  process.exit(1);
}
if (!SERVICE || !ANON) { console.error('Set SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY (npx supabase status).'); process.exit(1); }
const FAKE = 'http://127.0.0.1:8787';
const admin = createClient(API, SERVICE, { auth: { persistSession: false } });

let failures = 0;
const check = (label, ok, extra = '') => { console.log(`${ok ? '✓' : '✗'} ${label}${extra ? '  — ' + extra : ''}`); if (!ok) failures++; };
const mode = (m, delayMs = 0) => fetch(`${FAKE}/__mode`, { method: 'POST', body: JSON.stringify({ mode: m, delayMs }) });
const creates = async () => (await (await fetch(`${FAKE}/__creates`)).json()).length;
const must = ({ data, error }) => { if (error) throw new Error(error.message); return data; };

// ---- setup: a garage, its admin, invoicing connected ----
const email = `e2e-${Date.now()}@test.local`, password = 'e2e-password-123';
const user = must(await admin.auth.admin.createUser({ email, password, email_confirm: true })).user;
const garage = must(await admin.from('garages').insert({ name: 'E2E' }).select().single());
must(await admin.from('garage_members').insert({ garage_id: garage.id, user_id: user.id, role: 'admin' }));
must(await admin.from('garage_billing').insert({ garage_id: garage.id, provider: 'icount', active: true }));
must(await admin.from('garage_billing_secrets').insert({ garage_id: garage.id, credentials: { cid: 'x', token: 'y' } }));
const me = createClient(API, ANON, { auth: { persistSession: false } });
must(await me.auth.signInWithPassword({ email, password }));

let n = 0;
const newTicket = async () => {
  const t = must(await admin.from('tickets').insert({ garage_id: garage.id, key: `GAR-E${++n}`, title: 't', customer_name: 'לקוח' }).select().single());
  must(await admin.from('works').insert({ ticket_id: t.id, uid: 'w1', name: 'עבודה', labor: 100 }));
  return t;
};
const call = async (body) => {
  const { data, error } = await me.functions.invoke('issue-invoice', { body });
  if (!error) return { status: 200, data };
  const res = error.context; let b = null; try { b = await res.json(); } catch {}
  return { status: res?.status ?? 0, data: b };
};
const attempts = async (target) => must(await admin.from('billing_attempts').select('state, action').eq('target_id', target).order('created_at'));
const count = async (q) => (await q).data.length;

// A. two overlapping issues of one ticket
{
  const t = await newTicket(); await mode('ok', 1500);
  const r = await Promise.all([call({ action: 'issue', ticket_id: t.id, doc_type: 'tax_invoice' }), call({ action: 'issue', ticket_id: t.id, doc_type: 'tax_invoice' })]);
  check('A issue ×2 at once: one document at the provider', await creates() === 1, `creates=${await creates()} statuses=${r.map((x) => x.status)}`);
  check('A … the other was refused as in progress', r.some((x) => x.status === 409 && x.data?.code === 'billing_in_progress'));
  check('A … one bill stored', await count(admin.from('invoices').select('id').eq('ticket_id', t.id)) === 1);
  const a = await attempts(t.id); check('A … attempt recorded done', a.length === 1 && a[0].state === 'done', JSON.stringify(a));

  // B. two overlapping collects on that tax invoice
  const inv = must(await admin.from('invoices').select('id').eq('ticket_id', t.id).single());
  await mode('ok', 1500);
  const c = await Promise.all([call({ action: 'collect', invoice_id: inv.id }), call({ action: 'collect', invoice_id: inv.id })]);
  check('B collect ×2 at once: one receipt at the provider', await creates() === 1, `creates=${await creates()} statuses=${c.map((x) => x.status)}`);
  check('B … one receipt stored', await count(admin.from('invoices').select('id').eq('pays_invoice_id', inv.id)) === 1);
  await mode('ok');
  const again = await call({ action: 'collect', invoice_id: inv.id });
  check('B … a later collect is refused as settled, nothing created', again.status === 409 && await creates() === 0, `${again.status} ${again.data?.error}`);
}

// C. the provider creates the receipt but the answer is lost
{
  const t = await newTicket(); await mode('ok');
  must({ data: 1, error: (await call({ action: 'issue', ticket_id: t.id, doc_type: 'tax_invoice' })).status === 200 ? null : { message: 'issue failed' } });
  const inv = must(await admin.from('invoices').select('id').eq('ticket_id', t.id).single());
  await mode('created_then_html');
  const lost = await call({ action: 'collect', invoice_id: inv.id });
  check('C lost answer: reported as needs-check', lost.status === 502 && lost.data?.code === 'billing_needs_check', `${lost.status} ${lost.data?.error}`);
  const a = await attempts(inv.id); check('C … attempt recorded unknown', a.at(-1)?.state === 'unknown', JSON.stringify(a));
  await mode('ok');
  const retry = await call({ action: 'collect', invoice_id: inv.id });
  check('C … a retry is refused and creates nothing', retry.status === 409 && retry.data?.code === 'billing_needs_check' && await creates() === 0, `${retry.status} creates=${await creates()}`);
}

// D. the provider refuses: nothing exists, the ticket is free again
{
  const t = await newTicket(); await mode('refuse');
  const no = await call({ action: 'issue', ticket_id: t.id, doc_type: 'invoice_receipt' });
  check('D refusal: an error, attempt failed', no.status === 502 && (await attempts(t.id)).at(-1)?.state === 'failed', `${no.status} ${no.data?.error}`);
  await mode('ok');
  const yes = await call({ action: 'issue', ticket_id: t.id, doc_type: 'invoice_receipt' });
  check('D … a retry after a refusal goes through', yes.status === 200 && await creates() === 1, `${yes.status} ${yes.data?.error ?? ''}`);

  // E. two overlapping full credits of that invoice-receipt
  const inv = must(await admin.from('invoices').select('id').eq('ticket_id', t.id).eq('doc_type', 'invoice_receipt').single());
  await mode('ok', 1500);
  const cr = await Promise.all([call({ action: 'credit', invoice_id: inv.id, reason: 'x' }), call({ action: 'credit', invoice_id: inv.id, reason: 'x' })]);
  check('E credit ×2 at once: one credit note at the provider', await creates() === 1, `creates=${await creates()} statuses=${cr.map((x) => x.status)}`);
  check('E … one credit note stored, original cancelled',
    await count(admin.from('invoices').select('id').eq('credits_invoice_id', inv.id)) === 1
    && must(await admin.from('invoices').select('status').eq('id', inv.id).single()).status === 'cancelled');
}

// F. a counter sale pressed twice with one key
{
  await mode('ok', 1500);
  const key = crypto.randomUUID();
  const body = { action: 'issue_standalone', idempotency_key: key, customer_name: 'לקוח', lines: [{ desc: 'חלק', qty: 1, unit_price: 50 }] };
  const s = await Promise.all([call(body), call(body)]);
  check('F counter sale ×2, one key: one document', await creates() === 1, `creates=${await creates()} statuses=${s.map((x) => x.status)}`);
  await mode('ok');
  const replay = await call(body);
  check('F … a later replay returns the same document', replay.status === 200 && replay.data?.reused === true && await creates() === 0);
}

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
