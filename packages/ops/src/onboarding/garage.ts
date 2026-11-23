/* A garage, its users and its letterhead. The writes behind
 * scripts/onboard-garage.mjs and the console's onboarding form.
 *
 * This is the only way accounts come into existence. There is no self-signup,
 * no invite code and no join RPC — which is what makes "signed in but belongs
 * to no garage" unreachable rather than merely unlikely. A user and their
 * membership are written together here, or not at all.
 *
 * The role is always passed explicitly. The membership row is an upsert, so a
 * default would let a re-run quietly demote a garage's only admin — and since
 * there is no in-app role editor, the way back would be the service_role key.
 *
 * Every function throws on failure with a message meant for the operator.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from '../cli.ts';
import { allUsers } from '../garages.ts';
import type { Letterhead, MemberRole } from '../types.ts';
import { letterheadColumns, normalizeEmail } from './rules.ts';

export async function createGarage(db: SupabaseClient, name: string, letterhead: Partial<Letterhead> = {}): Promise<string> {
  const { data, error } = await db
    .from('garages')
    .insert({ name: name.trim(), ...letterheadColumns(letterhead) })
    .select('id')
    .single();
  if (error) throw new Error(`Could not create the garage: ${error.message}`);
  return String(data.id);
}

export async function findGarage(db: SupabaseClient, garageId: string): Promise<{ id: string; name: string }> {
  const { data, error } = await db.from('garages').select('id,name').eq('id', garageId).maybeSingle();
  if (error) throw new Error(`Could not look up the garage: ${error.message}`);
  if (!data) throw new Error(`No garage with id ${garageId}`);
  return { id: String(data.id), name: String(data.name) };
}

/** Writes only the fields given. Returns the columns written. */
export async function updateLetterhead(db: SupabaseClient, garageId: string, letterhead: Partial<Letterhead>): Promise<string[]> {
  const columns = letterheadColumns(letterhead);
  if (!Object.keys(columns).length) return [];
  const { error } = await db.from('garages').update(columns).eq('id', garageId);
  if (error) throw new Error(`Could not update the letterhead: ${error.message}`);
  return Object.keys(columns);
}

/** The user for an email, created if new. An existing user is not a failure —
 *  a run that fell over halfway must be repeatable, and that is exactly when a
 *  user exists without a membership. Their password is left alone.
 *
 *  email_confirm: there is no inbox in this flow; the operator hands the
 *  password over. Without it the account cannot sign in, which looks exactly
 *  like a wrong password. */
export async function ensureUser(
  db: SupabaseClient,
  emailRaw: string,
  password: string,
): Promise<{ userId: string; existing: boolean }> {
  const email = normalizeEmail(emailRaw);
  const { data: created, error } = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (!error) return { userId: created.user.id, existing: false };

  if (!/already been registered|already exists/i.test(error.message)) {
    throw new Error(`Could not create the user: ${error.message}`);
  }
  const found = (await allUsers(db)).find((u) => u.email?.toLowerCase() === email);
  if (!found) throw new Error(`User ${email} reported as existing but was not found.`);
  return { userId: found.id, existing: true };
}

/** The step that matters: a user without this row can sign in and see nothing. */
export async function linkMember(db: SupabaseClient, garageId: string, userId: string, role: MemberRole): Promise<void> {
  const { error } = await db
    .from('garage_members')
    .upsert({ garage_id: garageId, user_id: userId, role }, { onConflict: 'garage_id,user_id' });
  if (error) throw new Error(`User and garage exist but could not be linked: ${error.message}`);
}

/** Read back through the same table the app reads: the difference between
 *  "the inserts returned no error" and "this account can actually sign in". */
export async function verifyMembership(db: SupabaseClient, userId: string, garageId: string): Promise<void> {
  const { data, error } = await db
    .from('garage_members')
    .select('garage_id')
    .eq('user_id', userId)
    .eq('garage_id', garageId);
  if (error || !data?.length) throw new Error(`Verification failed: ${error?.message ?? 'no membership found'}`);
}

interface StarterCatalog {
  parts?: Record<string, unknown>[];
  works?: {
    code: string;
    name: string;
    labor: number;
    hours: number;
    position?: number;
    items?: Record<string, unknown>[];
  }[];
}

/** The standard works and parts, copied into one new garage. Off by default
 *  everywhere: a real garage starts empty and builds its own — a seeded part
 *  left behind reads as real stock at a price nobody chose. For demos and
 *  smoke tests.
 *
 *  A copy, not a reference: from here on the garage's catalog is its own.
 *  Never for a garage that already has a catalog — conflicting SKUs. */
export async function seedStarterCatalog(db: SupabaseClient, garageId: string): Promise<{ works: number; parts: number }> {
  const starter = JSON.parse(readFileSync(join(repoRoot, 'scripts', 'starter-catalog.json'), 'utf8')) as StarterCatalog;

  // Parts first: they are what a work's items refer to by SKU.
  const parts = (starter.parts ?? []).map((p) => ({ ...p, stock: 0, garage_id: garageId }));
  if (parts.length) {
    const { error } = await db.from('items').upsert(parts, { onConflict: 'garage_id,sku' });
    if (error) throw new Error(`Could not seed the parts catalog: ${error.message}`);
  }

  for (const w of starter.works ?? []) {
    const { data: row, error } = await db
      .from('work_defs')
      .insert({ garage_id: garageId, code: w.code, name: w.name, labor: w.labor, hours: w.hours, position: w.position ?? 0 })
      .select('id')
      .single();
    // A duplicate code means this garage was already seeded: skip, so a
    // half-finished run can be repeated.
    if (error) {
      if (/duplicate key/i.test(error.message)) continue;
      throw new Error(`Could not seed work ${w.code}: ${error.message}`);
    }
    if (w.items?.length) {
      const { error: itemErr } = await db
        .from('work_def_items')
        .insert(w.items.map((p, i) => ({ work_def_id: row.id, ...p, position: i })));
      if (itemErr) throw new Error(`Could not seed parts for work ${w.code}: ${itemErr.message}`);
    }
  }
  return { works: (starter.works ?? []).length, parts: parts.length };
}
