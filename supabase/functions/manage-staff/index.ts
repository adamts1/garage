// manage-staff — the only path that creates a person who can sign in to a
// garage, and the only one that changes what they are allowed to do.
//
// It runs server-side for the reason the client cannot get around: creating an
// auth account needs the service_role key, and that key can never be in a
// browser bundle. Until now the only way to make an account was
// scripts/onboard-garage.mjs, run by an operator with the key in their shell.
//
// Authorization is checked here rather than left to RLS, because the privileged
// client bypasses RLS entirely. The shape follows issue-invoice: a client built
// from the CALLER'S JWT establishes who they are and what garage they are in —
// garage_members_read_own means that lookup can only ever return their own row —
// and the service_role client is used only for the two things authenticated
// cannot do, creating an account and writing a membership.
//
// The garage is taken from the caller, never from the request. Same rule as
// create_ticket: a garage_id in a payload is a claim, not a fact.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

type Role = 'admin' | 'member';
const isRole = (v: unknown): v is Role => v === 'admin' || v === 'member';

/* The code is what every ticket stores in `assignee`, and the foreign key is on
   (garage_id, code) — so it has to be unique per garage and it has to be stable.
   Derived rather than asked for: it was a field on the form and nobody outside
   the database ever needs to see it. */
const codeFrom = (name: string, email: string): string => {
  const base = (name.trim() || email.split('@')[0] || 'staff')
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9\-֐-׿]/g, '')
    .slice(0, 8);
  return base || 'staff';
};

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

    /* Who is asking, and may they. RLS on garage_members restricts this select to
       the caller's own row, so the garage and the role both come from a place the
       caller cannot forge. */
    const { data: me, error: meErr } = await userClient
      .from('garage_members')
      .select('garage_id, role')
      .maybeSingle();
    if (meErr) return json({ error: meErr.message }, 400);
    if (!me) return json({ error: 'no garage for this session' }, 403);
    if (me.role !== 'admin') return json({ error: 'only an admin can manage staff' }, 403);

    const garageId = me.garage_id as string;
    const body = await req.json().catch(() => ({}));
    const action = body.action as string;

    // ============================ CREATE ============================
    if (action === 'create') {
      const email = String(body.email ?? '').trim().toLowerCase();
      const password = String(body.password ?? '');
      const name = String(body.name ?? '').trim();
      const role: Role = isRole(body.role) ? body.role : 'member';
      const color = String(body.color ?? '#3e5c76');
      const initials = String(body.initials ?? '').trim() || name.slice(0, 2);

      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'invalid email' }, 400);
      // Long enough to be worth having; Supabase's own floor is six.
      if (password.length < 8) return json({ error: 'password must be at least 8 characters' }, 400);
      if (!name) return json({ error: 'name required' }, 400);

      // email_confirm: there is no inbox in this flow. The admin hands the
      // password over directly, exactly as the onboarding script does.
      const { data: created, error: cErr } = await admin.auth.admin.createUser({
        email, password, email_confirm: true,
      });
      if (cErr || !created?.user) {
        const already = /already been registered|already exists/i.test(cErr?.message ?? '');
        return json({ error: already ? 'that email already has an account' : cErr?.message }, 400);
      }
      const userId = created.user.id;

      /* From here on a failure leaves an account with no garage — a person who
         can sign in and see nothing. So each step undoes the ones before it
         rather than leaving that behind. */
      const undo = async () => { await admin.auth.admin.deleteUser(userId).catch(() => {}); };

      const { error: mErr } = await admin
        .from('garage_members')
        .insert({ garage_id: garageId, user_id: userId, role });
      if (mErr) { await undo(); return json({ error: mErr.message }, 400); }

      /* The membership insert has already produced a worker row — the
         garage_members_ensure_worker trigger guarantees one exists for anybody
         who can sign in, whichever path created them. So this fills that row in
         with what the admin actually typed rather than inserting a second one,
         which the (garage_id, user_id) unique index would refuse anyway. */
      const { data: placeholder } = await admin
        .from('garage_workers')
        .select('id, code')
        .eq('garage_id', garageId).eq('user_id', userId)
        .maybeSingle();

      /* The code has to be unique per garage. Try the derived one, then suffix
         it — a garage with two people called דני is ordinary. The placeholder's
         own code is not a conflict with itself. */
      const base = codeFrom(name, email);
      let code = base;
      for (let n = 2; n <= 50; n++) {
        const { data: taken } = await admin
          .from('garage_workers').select('id')
          .eq('garage_id', garageId).eq('code', code)
          .neq('id', placeholder?.id ?? '00000000-0000-0000-0000-000000000000')
          .maybeSingle();
        if (!taken) break;
        code = `${base}-${n}`;
      }

      const fields = { code, name, initials, color };
      const { data: worker, error: wErr } = placeholder
        ? await admin.from('garage_workers').update(fields).eq('id', placeholder.id)
            .select('id, code, name, initials, color, position, active, user_id').single()
        : await admin.from('garage_workers').insert({ garage_id: garageId, user_id: userId, ...fields })
            .select('id, code, name, initials, color, position, active, user_id').single();
      if (wErr) {
        await admin.from('garage_members').delete().eq('garage_id', garageId).eq('user_id', userId);
        await undo();
        return json({ error: wErr.message }, 400);
      }

      return json({ worker: { ...worker, email, role } });
    }

    // =========================== SET ROLE ===========================
    if (action === 'set_role') {
      const userId = String(body.user_id ?? '');
      const role = body.role;
      if (!userId) return json({ error: 'user_id required' }, 400);
      if (!isRole(role)) return json({ error: 'role must be admin or member' }, 400);

      const { data: target } = await admin
        .from('garage_members')
        .select('role')
        .eq('garage_id', garageId).eq('user_id', userId)
        .maybeSingle();
      if (!target) return json({ error: 'that person is not in your garage' }, 404);

      /* A garage with no admin cannot appoint one: nothing in the app can write
         a role, so the only way back is the service_role key and a shell. Refuse
         the step that gets there — including an admin demoting themselves, which
         is the likeliest way it would happen. */
      if (target.role === 'admin' && role === 'member') {
        const { count } = await admin
          .from('garage_members')
          .select('user_id', { count: 'exact', head: true })
          .eq('garage_id', garageId).eq('role', 'admin');
        if ((count ?? 0) <= 1) {
          return json({ error: 'this is the last admin — appoint another before stepping down' }, 409);
        }
      }

      const { error: uErr } = await admin
        .from('garage_members')
        .update({ role })
        .eq('garage_id', garageId).eq('user_id', userId);
      if (uErr) return json({ error: uErr.message }, 400);

      return json({ user_id: userId, role });
    }

    return json({ error: `unknown action: ${action}` }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
