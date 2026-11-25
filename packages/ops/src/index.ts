/* Operator logic for scripts/ and the local admin console (admin/).
 *
 * Node only: it reads env files holding service_role keys and shells out to
 * the Supabase and EAS CLIs. Nothing under src/ or mobile/ may import it — the
 * app's bundle must never contain a path to a service_role key.
 *
 * The console's PAGE may import exactly two files from here, both free of
 * Node: ./types.ts and ./onboarding/rules.ts. */
export * from './cli.ts';
export * from './environments.ts';
export * from './functions.ts';
export * from './garages.ts';
export * from './migrations.ts';
export * from './mobile.ts';
export * from './onboarding/billing.ts';
export * from './onboarding/garage.ts';
export * from './onboarding/onboard.ts';
export * from './onboarding/payments.ts';
export * from './onboarding/rules.ts';
export type * from './types.ts';
