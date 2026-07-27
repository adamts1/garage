#!/usr/bin/env node
/* Tenant isolation, proven against a real database.
 *
 *   npx supabase start && node supabase/tests/tenancy.mjs
 *
 * Runs in CI against the clean database the migrations job already builds. It
 * talks to PostgREST over HTTP with real user sessions rather than to Postgres
 * as a superuser, because that is the path the apps take and it is the only one
 * where both the GRANT and the policy are exercised. A psql test with `set role`
 * skips a class of failure entirely: a missing grant looks like a passing
 * isolation test right up until the app makes the same call and gets a 401.
 *
 * Today this asserts what 2b actually guarantees, which is narrow — the
 * membership map is private, and a session resolves to its own garage and no
 * other. It deliberately does NOT assert that garage A cannot read garage B's
 * tickets, because demo_all still permits exactly that and a test claiming
 * otherwise would fail. Phase 2c flips those policies and turns the pending
 * block at the bottom into the real gate.
 */

const API = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON = process.env.SUPABASE_ANON_KEY
  ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY
  ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '\x1b[32m  ok\x1b[0m' : '\x1b[31mFAIL\x1b[0m'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

const rest = (path, token, init = {}) =>
  fetch(`${API}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });

const admin = (path, init = {}) =>
  fetch(`${API}${path}`, {
    ...init,
    headers: {
      apikey: SERVICE,
      Authorization: `Bearer ${SERVICE}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });

/** Create a garage, a user, and the membership joining them. */
const makeTenant = async (garageName, email) => {
  const password = `Test-${Math.abs(hash(email))}-pw`;

  const gRes = await admin('/rest/v1/garages', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ name: garageName }),
  });
  const garage = (await gRes.json())[0];
  if (!garage?.id) throw new Error(`could not create garage: ${JSON.stringify(garage)}`);

  const uRes = await admin('/auth/v1/admin/users', {
    method: 'POST',
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  const user = await uRes.json();
  if (!user?.id) throw new Error(`could not create user: ${JSON.stringify(user)}`);

  await admin('/rest/v1/garage_members', {
    method: 'POST',
    body: JSON.stringify({ garage_id: garage.id, user_id: user.id }),
  });

  const sRes = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const session = await sRes.json();
  if (!session.access_token) throw new Error(`could not sign in: ${JSON.stringify(session)}`);

  return { garage, user, token: session.access_token };
};

// Deterministic per-email password; avoids a random that differs between the
// create and the sign-in if this is ever retried.
function hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}

/* ---------------------------------------------------------------- */

console.log('\nTenant isolation\n');

const stamp = process.env.GITHUB_RUN_ID ?? String(process.pid);
const a = await makeTenant('Garage A', `iso-a-${stamp}@garage.test`);
const b = await makeTenant('Garage B', `iso-b-${stamp}@garage.test`);

/* ---------- the membership map is not public ---------- */

const anonGarages = await rest('garages?select=id', ANON);
check(
  'anon cannot read garages',
  anonGarages.status === 401,
  `got ${anonGarages.status}`,
);

const anonMembers = await rest('garage_members?select=user_id', ANON);
check(
  'anon cannot read garage_members',
  anonMembers.status === 401,
  `got ${anonMembers.status}`,
);

/* ---------- a session sees its own garage, and only its own ---------- */

const aGarages = await (await rest('rpc/my_garages', a.token, { method: 'POST', body: '{}' })).json();
check(
  'my_garages returns exactly one garage for A',
  Array.isArray(aGarages) && aGarages.length === 1,
  `got ${JSON.stringify(aGarages)}`,
);
check(
  "my_garages returns A's garage, not B's",
  aGarages[0]?.garage_id === a.garage.id,
);

const aSeesGarages = await (await rest('garages?select=id,name', a.token)).json();
check(
  'A can read exactly one row from garages',
  Array.isArray(aSeesGarages) && aSeesGarages.length === 1,
  `got ${aSeesGarages.length ?? '?'} rows`,
);
check(
  "A cannot see B's garage row",
  !aSeesGarages.some?.((g) => g.id === b.garage.id),
);

const aSeesMembers = await (await rest('garage_members?select=user_id,garage_id', a.token)).json();
check(
  'A sees only their own membership row',
  Array.isArray(aSeesMembers) && aSeesMembers.length === 1 && aSeesMembers[0].user_id === a.user.id,
  `got ${JSON.stringify(aSeesMembers)}`,
);

/* ---------- the works catalog is per-garage ----------
 *
 * work_defs and work_def_items were created with tenant policies from the
 * start, so unlike tickets they can be asserted before the flip. These are the
 * first checks in this file that prove data isolation rather than just
 * membership privacy.
 */

const seedWork = async (tenant, code, name, labor) => {
  const res = await rest('work_defs', tenant.token, {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ garage_id: tenant.garage.id, code, name, labor }),
  });
  const body = await res.json();
  return Array.isArray(body) ? body[0] : body;
};

const aWork = await seedWork(a, 'AAA-01', 'A only', 111);
const bWork = await seedWork(b, 'AAA-01', 'B only', 222);

check(
  'two garages can hold the same work code',
  Boolean(aWork?.id && bWork?.id),
  `a=${aWork?.id ?? JSON.stringify(aWork)} b=${bWork?.id ?? JSON.stringify(bWork)}`,
);

const aSeesWorks = await (await rest('work_defs?select=code,name', a.token)).json();
check(
  "A's catalog contains A's work and not B's",
  Array.isArray(aSeesWorks) &&
    aSeesWorks.some((w) => w.name === 'A only') &&
    !aSeesWorks.some((w) => w.name === 'B only'),
  `got ${JSON.stringify(aSeesWorks)}`,
);

const bReadsAWork = await (await rest(`work_defs?id=eq.${aWork?.id}&select=id`, b.token)).json();
check(
  "B cannot read A's work by its id",
  Array.isArray(bReadsAWork) && bReadsAWork.length === 0,
  `got ${JSON.stringify(bReadsAWork)}`,
);

// WITH CHECK, not USING: the row would be invisible to B either way, but
// without WITH CHECK the insert itself would succeed and quietly land in A.
const forge = await rest('work_defs', b.token, {
  method: 'POST',
  body: JSON.stringify({ garage_id: a.garage.id, code: 'FORGED', name: 'forged', labor: 1 }),
});
check(
  "B cannot insert a work into A's garage",
  forge.status === 403 || forge.status === 401,
  `got ${forge.status}`,
);

/* ---------- a user with no membership resolves to nothing ---------- */

const orphanEmail = `iso-orphan-${stamp}@garage.test`;
const orphanPassword = `Test-${Math.abs(hash(orphanEmail))}-pw`;
await admin('/auth/v1/admin/users', {
  method: 'POST',
  body: JSON.stringify({ email: orphanEmail, password: orphanPassword, email_confirm: true }),
});
const orphanSession = await (
  await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: orphanEmail, password: orphanPassword }),
  })
).json();

const orphanGarages = await (
  await rest('rpc/my_garages', orphanSession.access_token, { method: 'POST', body: '{}' })
).json();
check(
  'a user with no membership gets zero garages',
  Array.isArray(orphanGarages) && orphanGarages.length === 0,
  `got ${JSON.stringify(orphanGarages)}`,
);
// This is the state AuthGate must refuse to render a board for. The app-side
// half of this rule is covered in packages/shared/src/auth.test.ts.

/* ---------- the gate ----------
 *
 * docs/PRODUCTION.md §5 requires an automated test proving garage A cannot read
 * garage B, running in CI permanently. This is it. These assertions were
 * written as comments through 2a and 2b and turned on with the flip; they must
 * never be commented out again.
 */

const makeTicket = async (tenant, key, title) => {
  const res = await rest('tickets', tenant.token, {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ key, title, status: 'todo' }),
  });
  const body = await res.json();
  return { status: res.status, row: Array.isArray(body) ? body[0] : body };
};

const aTicket = await makeTicket(a, `ISO-A-${stamp}`, 'A ticket');
check(
  'A can create a ticket without naming a garage',
  aTicket.status === 201 && Boolean(aTicket.row?.id),
  `got ${aTicket.status} ${JSON.stringify(aTicket.row).slice(0, 120)}`,
);
check(
  "the ticket landed in A's garage, from the column default",
  aTicket.row?.garage_id === a.garage.id,
  `got ${aTicket.row?.garage_id}`,
);

await makeTicket(b, `ISO-B-${stamp}`, 'B ticket');

const aTickets = await (await rest('tickets?select=key,garage_id', a.token)).json();
check(
  "A sees only A's tickets",
  Array.isArray(aTickets) && aTickets.every((t) => t.garage_id === a.garage.id),
  `${Array.isArray(aTickets) ? aTickets.length : '?'} rows, garages ${[...new Set((aTickets ?? []).map((t) => t.garage_id))].length}`,
);
check(
  "A cannot see B's ticket",
  Array.isArray(aTickets) && !aTickets.some((t) => t.key === `ISO-B-${stamp}`),
);

const bReadsA = await (await rest(`tickets?id=eq.${aTicket.row?.id}&select=id`, b.token)).json();
check(
  "B cannot read A's ticket by its id",
  Array.isArray(bReadsA) && bReadsA.length === 0,
  `got ${JSON.stringify(bReadsA)}`,
);

// The update reports success with zero rows affected rather than an error —
// PostgREST cannot update a row the policy hides. Asserting on the row's
// contents afterwards is what actually proves it.
await rest(`tickets?id=eq.${aTicket.row?.id}`, b.token, {
  method: 'PATCH',
  body: JSON.stringify({ title: 'B was here' }),
});
const stillMine = await (await rest(`tickets?id=eq.${aTicket.row?.id}&select=title`, a.token)).json();
check(
  "B cannot modify A's ticket",
  stillMine?.[0]?.title === 'A ticket',
  `title is now ${JSON.stringify(stillMine?.[0]?.title)}`,
);

await rest(`tickets?id=eq.${aTicket.row?.id}`, b.token, { method: 'DELETE' });
const stillThere = await (await rest(`tickets?id=eq.${aTicket.row?.id}&select=id`, a.token)).json();
check("B cannot delete A's ticket", stillThere?.length === 1);

const forgedTicket = await rest('tickets', b.token, {
  method: 'POST',
  body: JSON.stringify({ key: `ISO-FORGE-${stamp}`, title: 'forged', status: 'todo', garage_id: a.garage.id }),
});
check(
  "B cannot create a ticket inside A's garage",
  forgedTicket.status === 403 || forgedTicket.status === 401,
  `got ${forgedTicket.status}`,
);

/* ---------- ticket photos: a private bucket, per garage ----------
 *
 * Photos of customers' cars, number plates included. Before 2c the bucket was
 * public and its policies checked only the bucket name, so any leaked URL was a
 * permanent, unauthenticated grant.
 */

const storage = (path, token, init = {}) =>
  fetch(`${API}/storage/v1/${path}`, {
    ...init,
    headers: { apikey: ANON, Authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
  });

const aPhotoPath = `${a.garage.id}/ISO-A-${stamp}/photo.txt`;
const upA = await storage(`object/ticket-photos/${aPhotoPath}`, a.token, {
  method: 'POST',
  headers: { 'Content-Type': 'text/plain' },
  body: 'pretend this is a car',
});
check('A can upload into its own garage folder', upA.status === 200, `got ${upA.status}`);

const forgedUpload = await storage(`object/ticket-photos/${a.garage.id}/forged/x.txt`, b.token, {
  method: 'POST',
  headers: { 'Content-Type': 'text/plain' },
  body: 'B writing into A',
});
check(
  "B cannot upload into A's garage folder",
  forgedUpload.status === 400 || forgedUpload.status === 403 || forgedUpload.status === 401,
  `got ${forgedUpload.status}`,
);

const signA = await storage(`object/sign/ticket-photos/${aPhotoPath}`, a.token, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ expiresIn: 60 }),
});
check('A can sign a URL for its own photo', signA.status === 200, `got ${signA.status}`);

const signB = await storage(`object/sign/ticket-photos/${aPhotoPath}`, b.token, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ expiresIn: 60 }),
});
check(
  "B cannot sign a URL for A's photo",
  signB.status !== 200,
  `got ${signB.status}`,
);

// The whole point of a private bucket: the unsigned path is not a URL any more.
const unsigned = await fetch(`${API}/storage/v1/object/public/ticket-photos/${aPhotoPath}`);
check(
  'the public URL for a photo no longer resolves',
  unsigned.status !== 200,
  `got ${unsigned.status}`,
);

const anonSign = await storage(`object/sign/ticket-photos/${aPhotoPath}`, ANON, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ expiresIn: 60 }),
});
check('anon cannot sign a URL for any photo', anonSign.status !== 200, `got ${anonSign.status}`);

/* Photos uploaded before 2c have no garage prefix — their paths start with the
 * ticket key. Those objects cannot be renamed from SQL (moving a stored object
 * is a storage API call), so the policy authorises them through the
 * ticket_photos row instead. Staging and production both hold such photos, and
 * if this arm is wrong they become permanently unreadable to their owner while
 * every new upload keeps working — a failure that would look like corruption
 * rather than a policy bug.
 *
 * Placed with service_role, because the INSERT policy rightly refuses to create
 * an unprefixed object now. */
const legacyPath = `GAR-LEGACY-${stamp}/old-photo.txt`;
await fetch(`${API}/storage/v1/object/ticket-photos/${legacyPath}`, {
  method: 'POST',
  headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'text/plain' },
  body: 'uploaded before 2c',
});
// Checked, not fired and forgotten: this insert failed silently once, and the
// assertion below then failed for a reason that had nothing to do with the
// policy it was testing.
const legacyRow = await admin('/rest/v1/ticket_photos', {
  method: 'POST',
  headers: { Prefer: 'return=representation' },
  body: JSON.stringify({ ticket_id: aTicket.row?.id, path: legacyPath }),
});
check(
  'setup: a pre-2c photo row can be created by service_role',
  legacyRow.status === 201,
  `got ${legacyRow.status} ${(await legacyRow.clone().text()).slice(0, 140)}`,
);

const signLegacyA = await storage(`object/sign/ticket-photos/${legacyPath}`, a.token, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ expiresIn: 60 }),
});
check(
  'A can still sign a pre-2c photo of its own (no garage prefix)',
  signLegacyA.status === 200,
  `got ${signLegacyA.status}`,
);

const signLegacyB = await storage(`object/sign/ticket-photos/${legacyPath}`, b.token, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ expiresIn: 60 }),
});
check(
  "B cannot sign A's pre-2c photo",
  signLegacyB.status !== 200,
  `got ${signLegacyB.status}`,
);

/* ---------- and the anon key, which is public ---------- */
for (const table of ['tickets', 'customers', 'items', 'works', 'work_items', 'vehicles', 'ticket_photos']) {
  const res = await rest(`${table}?select=id&limit=1`, ANON);
  const body = res.status === 200 ? await res.json() : null;
  check(
    `anon reads nothing from ${table}`,
    res.status === 401 || res.status === 403 || (Array.isArray(body) && body.length === 0),
    `got ${res.status}${body ? ` with ${body.length} rows` : ''}`,
  );
}

/* ============================================================
 *  Phase 3 — data integrity. These share the isolation harness because they
 *  need the same thing: real sessions over PostgREST, two tenants, a clean DB.
 * ============================================================ */

const rpc = (name, token, body) =>
  rest(`rpc/${name}`, token, { method: 'POST', body: JSON.stringify(body) });

/* 3.4 — concurrent create_ticket calls get distinct, consecutive keys. Ten at
 * once through the same counter row; a client-side max+1 would have collided. */
const raceResults = await Promise.all(
  Array.from({ length: 10 }, (_, i) =>
    rpc('create_ticket', a.token, { t: { title: `race-${i}`, status: 'todo' } }).then((r) => r.json()),
  ),
);
const raceKeys = raceResults.map((r) => r.key).filter(Boolean);
check(
  '10 concurrent create_ticket calls get 10 unique keys',
  new Set(raceKeys).size === 10,
  `got ${raceKeys.length} keys, ${new Set(raceKeys).size} unique`,
);

/* create_ticket assigns the garage from the session, not the payload: a forged
 * garage_id in the body must be ignored, not honoured. */
const forgedCreate = await (await rpc('create_ticket', b.token, {
  t: { title: 'forge', status: 'todo', garage_id: a.garage.id },
})).json();
const forgedId = forgedCreate.id;
const forgedSeenByA = await (await rest(`tickets?id=eq.${forgedId}&select=id`, a.token)).json();
check(
  "create_ticket ignores a forged garage_id — B's ticket is not in A's garage",
  Array.isArray(forgedSeenByA) && forgedSeenByA.length === 0,
  `got ${JSON.stringify(forgedSeenByA)}`,
);

/* 3.5 — a create that fails partway rolls back completely. A work with a
 * non-numeric labor aborts the cast; no ticket may survive. */
const beforeCount = (await (await rest('tickets?select=id', a.token)).json()).length;
await rpc('create_ticket', a.token, {
  t: { title: 'should roll back', status: 'todo' },
  works: [{ uid: 'ok', name: 'ok', labor: 1 }, { uid: 'bad', name: 'bad', labor: 'not-a-number' }],
});
const afterCount = (await (await rest('tickets?select=id', a.token)).json()).length;
check('a failed create_ticket leaves no orphan ticket', beforeCount === afterCount, `${beforeCount} → ${afterCount}`);

/* 3.6 — customers are identified by ת״ז, then phone, never by name. */
await rpc('create_ticket', a.token, { t: { title: 't1', customer_name: 'שם זהה', id_number: 'IDA-1' } });
await rpc('create_ticket', a.token, { t: { title: 't2', customer_name: 'שם זהה', id_number: 'IDA-2' } });
const sameName = await (await rest(`customers?name=eq.${encodeURIComponent('שם זהה')}&select=id`, a.token)).json();
check(
  'same name, different ת״ז stays two customers (no name merge)',
  Array.isArray(sameName) && sameName.length === 2,
  `got ${Array.isArray(sameName) ? sameName.length : '?'}`,
);

await rpc('create_ticket', a.token, { t: { title: 't3', customer_name: 'שם זהה', id_number: 'IDA-1' } });
const reused = await (await rest('customers?id_number=eq.IDA-1&select=id', a.token)).json();
check('the same ת״ז reuses one customer', Array.isArray(reused) && reused.length === 1, `got ${reused.length}`);

/* A duplicate ת״ז cannot be inserted directly either — the partial unique index,
 * not just the RPC's politeness, is what guarantees it. */
const dupIns = await rest('customers', a.token, {
  method: 'POST',
  body: JSON.stringify({ name: 'dup', id_number: 'IDA-1' }),
});
check('a duplicate ת״ז insert is rejected by the unique index', dupIns.status >= 400, `got ${dupIns.status}`);

/* ============================================================
 *  Phase 4a — invoices are stored, tenant-scoped, and client-unforgeable.
 *  A tax document may be READ by its garage and by nobody else, and may be
 *  WRITTEN by no client at all — only the service_role Edge Function issues one.
 * ============================================================ */

// Seed one invoice for A, as the Edge Function would (service_role, explicit
// garage_id since there is no session default under service_role).
const invSeedRes = await admin('/rest/v1/invoices', {
  method: 'POST',
  headers: { Prefer: 'return=representation' },
  body: JSON.stringify({
    garage_id: a.garage.id,
    doc_type: 'invoice_receipt',
    provider: 'icount',
    provider_docnum: `TST-${stamp}`,
    subtotal: 100, vat_rate: 0.18, vat: 18, total: 118,
    status: 'issued',
  }),
});
const invSeed = (await invSeedRes.json())[0];
check('service_role can store an invoice for a garage', invSeedRes.status === 201 && Boolean(invSeed?.id), `got ${invSeedRes.status}`);

const aSeesInv = await (await rest(`invoices?provider_docnum=eq.TST-${stamp}&select=id`, a.token)).json();
check('A reads its own invoice', Array.isArray(aSeesInv) && aSeesInv.length === 1, `got ${Array.isArray(aSeesInv) ? aSeesInv.length : '?'}`);

const bSeesInv = await (await rest(`invoices?provider_docnum=eq.TST-${stamp}&select=id`, b.token)).json();
check("B cannot read A's invoice", Array.isArray(bSeesInv) && bSeesInv.length === 0, `got ${JSON.stringify(bSeesInv)}`);

// A client must not be able to fabricate a tax document.
const forgeInv = await rest('invoices', a.token, {
  method: 'POST',
  body: JSON.stringify({ garage_id: a.garage.id, doc_type: 'invoice_receipt', provider_docnum: `FORGE-${stamp}`, subtotal: 1, vat_rate: 0.18, vat: 0, total: 1 }),
});
check('authenticated cannot INSERT an invoice (no grant)', forgeInv.status >= 400, `got ${forgeInv.status}`);

// Nor edit or delete an issued one.
const editInv = await rest(`invoices?id=eq.${invSeed?.id}`, a.token, { method: 'PATCH', body: JSON.stringify({ total: 1 }) });
check('authenticated cannot UPDATE an invoice', editInv.status >= 400 || (Array.isArray(await editInv.json().catch(() => [])) === false), `got ${editInv.status}`);

const delInv = await rest(`invoices?id=eq.${invSeed?.id}`, a.token, { method: 'DELETE' });
const stillThereInv = await (await rest(`invoices?id=eq.${invSeed?.id}&select=id`, a.token)).json();
check('authenticated cannot DELETE an invoice', Array.isArray(stillThereInv) && stillThereInv.length === 1, `delete got ${delInv.status}`);

// The provider credentials are invisible to every client — no grant on the secrets table.
const secretPeek = await rest('garage_billing_secrets?select=credentials', a.token);
const secretBody = secretPeek.status === 200 ? await secretPeek.json() : null;
check(
  'authenticated cannot read garage_billing_secrets',
  secretPeek.status >= 400 || (Array.isArray(secretBody) && secretBody.length === 0),
  `got ${secretPeek.status}${secretBody ? ` with ${secretBody.length} rows` : ''}`,
);

if (failures) {
  console.error(`\x1b[31m${failures} check(s) failed.\x1b[0m\n`);
  process.exit(1);
}
console.log('\x1b[32mAll tenant isolation checks passed.\x1b[0m\n');
