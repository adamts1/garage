/* The three environments, and a checked service_role client for each.
 *
 * The env files are the same ones the scripts read — .env.local for staging,
 * .env.production.local for production — so the console needs no secret of its
 * own. They are parsed here rather than loaded into process.env: the console
 * talks to all three at once, and process.env can hold only one of them.
 *
 * Every client is checked before it is handed out: the key must be a
 * service_role key, it must belong to the project in the URL, and — for the
 * console — that project must be the one this environment is supposed to be.
 * The scripts get the first two checks through checkedClient(); they are
 * pointed at an environment by the env file they were launched with.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import { localStatus, repoRoot } from './cli.ts';
import type { EnvId, Environment, EnvironmentInfo } from './types.ts';

export const PRODUCTION_PROJECT_REF = 'farpgkljbmlaeiocrore';

/* Production first: it is the one with real garages, and the console lists
   in this order. */
export const ENVIRONMENTS: readonly Environment[] = [
  { id: 'production', label: 'ייצור', ref: PRODUCTION_PROJECT_REF, envFile: '.env.production.local', gitRef: 'origin/main' },
  { id: 'staging', label: 'בדיקות', ref: 'poksqsdklnhaumozriqd', envFile: '.env.local', gitRef: 'origin/staging' },
  { id: 'local', label: 'מקומית', ref: null, envFile: null, gitRef: null },
];

export const isEnvId = (v: unknown): v is EnvId => ENVIRONMENTS.some((e) => e.id === v);

export function environment(id: unknown): Environment {
  const env = ENVIRONMENTS.find((e) => e.id === id);
  if (!env) throw new Error(`unknown environment: ${String(id)}`);
  return env;
}

/** What the page may know about an environment: no file names. */
export const environmentInfo = ({ id, label, ref, gitRef }: Environment): EnvironmentInfo =>
  ({ id, label, ref, gitRef });

const claims = (key: string): Record<string, unknown> | null => {
  try {
    return JSON.parse(Buffer.from(key.split('.')[1] ?? '', 'base64url').toString()) as Record<string, unknown>;
  } catch {
    return null;
  }
};

/** Newer projects issue opaque sb_secret_ keys, which carry no readable claims;
 *  the anon equivalent is sb_publishable_, so the prefix alone is decisive. */
export const looksLikeServiceRole = (key: string): boolean => {
  if (key.startsWith('sb_secret_')) return true;
  if (key.startsWith('sb_publishable_')) return false;
  return claims(key)?.role === 'service_role';
};

/** The project a JWT key belongs to, or null for opaque keys. */
export const keyProjectRef = (key: string): string | null => {
  if (key.startsWith('sb_secret_')) return null;
  const ref = claims(key)?.ref;
  return typeof ref === 'string' ? ref : null;
};

export const projectRefOf = (url: string): string => url.replace(/^https?:\/\//, '').split('.')[0] ?? '';

export interface Credentials {
  url: string;
  serviceKey: string;
}

/** The two checks every writer makes before touching anything: a service_role
 *  key (the anon key is a plausible paste mistake — both are JWTs from the same
 *  dashboard page), and one that belongs to the project in the URL (a
 *  production key with a staging URL is the dangerous direction). Throws. */
export function checkCredentials({ url, serviceKey }: Credentials, source = 'SUPABASE_SERVICE_ROLE_KEY'): void {
  if (!looksLikeServiceRole(serviceKey)) {
    throw new Error(`${source} is not a service_role key — check you did not paste the anon key.`);
  }
  const urlRef = projectRefOf(url);
  const keyRef = keyProjectRef(serviceKey);
  if (keyRef && keyRef !== urlRef) {
    throw new Error(`Key/URL mismatch: the key belongs to "${keyRef}" but the URL points at "${urlRef}".`);
  }
}

export function checkedClient(creds: Credentials, source?: string): SupabaseClient {
  checkCredentials(creds, source);
  return createClient(creds.url, creds.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** URL + service_role key for one environment, checked, including that the
 *  file really points at this environment's project. */
export async function credentials(id: EnvId): Promise<Credentials> {
  const env = environment(id);

  if (env.id === 'local') {
    const status = await localStatus();
    if (!status) throw new Error('הסביבה המקומית לא רצה (npx supabase start)');
    return { url: status.API_URL, serviceKey: status.SERVICE_ROLE_KEY };
  }

  const file = env.envFile ?? '';
  const path = join(repoRoot, file);
  if (!existsSync(path)) throw new Error(`חסר הקובץ ${file}`);
  const vars = parseEnv(readFileSync(path, 'utf8'));
  const url = (vars.SUPABASE_URL ?? vars.VITE_SUPABASE_URL)?.trim();
  const serviceKey = vars.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceKey) throw new Error(`ב־${file} חסרים SUPABASE_URL או SUPABASE_SERVICE_ROLE_KEY`);

  const urlRef = projectRefOf(url);
  if (urlRef !== env.ref) throw new Error(`${file} מצביע על ${urlRef}, אבל ${env.id} הוא ${env.ref}`);
  checkCredentials({ url, serviceKey }, `the key in ${file}`);
  return { url, serviceKey };
}

export interface ServiceConnection {
  db: SupabaseClient;
  projectRef: string;
}

export async function serviceClient(id: EnvId): Promise<ServiceConnection> {
  const creds = await credentials(id);
  return {
    db: checkedClient(creds),
    projectRef: id === 'local' ? 'local' : projectRefOf(creds.url),
  };
}
