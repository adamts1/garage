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

/* ---------- 2c: the gate this file exists to become ----------
 *
 * Until the demo_all policies are replaced, anon and every session can read
 * every tenant's rows, so these cannot pass yet. They are written out rather
 * than left to memory because the point of 2c is that they start passing and
 * never stop.
 *
 *   check("A cannot read B's tickets", ...)
 *   check("A cannot write into B's garage", ...)
 *   check('anon cannot read tickets at all', ...)
 *   check("A cannot read B's ticket photos from storage", ...)
 */
console.log('\n  (2c will add: A cannot read B\'s tickets, and anon cannot read any)\n');

if (failures) {
  console.error(`\x1b[31m${failures} check(s) failed.\x1b[0m\n`);
  process.exit(1);
}
console.log('\x1b[32mAll tenant isolation checks passed.\x1b[0m\n');
