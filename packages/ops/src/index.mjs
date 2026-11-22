/* Operator logic for scripts/ and the local admin console (admin/).
 *
 * Node only: it reads env files holding service_role keys and shells out to
 * the Supabase CLI. Nothing under src/ or mobile/ may import it — the app's
 * bundle must never contain a path to a service_role key. */
export * from './cli.mjs';
export * from './environments.mjs';
export * from './migrations.mjs';
export * from './functions.mjs';
export * from './garages.mjs';
