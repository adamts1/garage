/* The three environments, and a service_role client for each.
 *
 * The env files are the same ones the scripts read — .env.local for staging,
 * .env.production.local for production — so the console needs no secret of its
 * own. They are parsed here rather than loaded into process.env: the console
 * talks to all three at once, and process.env can hold only one of them.
 *
 * Every client is checked before it is handed out: the key must be a
 * service_role key, it must belong to the project in the URL, and that project
 * must be the one this environment is supposed to be. The last check is new
 * relative to the scripts — a .env.local that was edited to point at production
 * would otherwise show production's garages under the "staging" heading.
 */

import { createClient } from '@supabase/supabase-js';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import { localStatus, repoRoot } from './cli.mjs';

/* Production first: it is the one with real garages, and the console lists
   in this order. */
export const ENVIRONMENTS = [
  { id: 'production', label: 'ייצור', ref: 'farpgkljbmlaeiocrore', envFile: '.env.production.local', gitRef: 'origin/main' },
  { id: 'staging', label: 'בדיקות', ref: 'poksqsdklnhaumozriqd', envFile: '.env.local', gitRef: 'origin/staging' },
  { id: 'local', label: 'מקומית', ref: null, envFile: null, gitRef: null },
];

export const environment = (id) => {
  const env = ENVIRONMENTS.find((e) => e.id === id);
  if (!env) throw new Error(`unknown environment: ${id}`);
  return env;
};

const claims = (key) => {
  try {
    return JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString());
  } catch {
    return null;
  }
};

/** Newer projects issue opaque sb_secret_ keys, which carry no readable claims;
 *  the anon equivalent is sb_publishable_, so the prefix alone is decisive. */
export const looksLikeServiceRole = (key) => {
  if (key.startsWith('sb_secret_')) return true;
  if (key.startsWith('sb_publishable_')) return false;
  return claims(key)?.role === 'service_role';
};

/** The project a JWT key belongs to, or null for opaque keys. */
export const keyProjectRef = (key) => (key.startsWith('sb_secret_') ? null : claims(key)?.ref ?? null);

export const projectRefOf = (url) => url.replace(/^https?:\/\//, '').split('.')[0];

/** URL + service_role key for one environment, checked. Throws with a message
 *  meant for the operator. */
export async function credentials(id) {
  const env = environment(id);

  if (env.id === 'local') {
    const status = await localStatus();
    if (!status) throw new Error('הסביבה המקומית לא רצה (npx supabase start)');
    return { url: status.API_URL, serviceKey: status.SERVICE_ROLE_KEY };
  }

  const path = join(repoRoot, env.envFile);
  if (!existsSync(path)) throw new Error(`חסר הקובץ ${env.envFile}`);
  const vars = parseEnv(readFileSync(path, 'utf8'));
  const url = (vars.SUPABASE_URL ?? vars.VITE_SUPABASE_URL)?.trim();
  const serviceKey = vars.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceKey) throw new Error(`ב־${env.envFile} חסרים SUPABASE_URL או SUPABASE_SERVICE_ROLE_KEY`);

  if (!looksLikeServiceRole(serviceKey)) throw new Error(`המפתח ב־${env.envFile} אינו מפתח service_role`);
  const urlRef = projectRefOf(url);
  if (urlRef !== env.ref) {
    throw new Error(`${env.envFile} מצביע על ${urlRef}, אבל ${env.id} הוא ${env.ref}`);
  }
  const keyRef = keyProjectRef(serviceKey);
  if (keyRef && keyRef !== urlRef) throw new Error(`המפתח ב־${env.envFile} שייך ל־${keyRef} ולא ל־${urlRef}`);

  return { url, serviceKey };
}

export async function serviceClient(id) {
  const { url, serviceKey } = await credentials(id);
  return createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
}
