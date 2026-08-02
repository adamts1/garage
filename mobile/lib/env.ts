/* Which build this is, and whether it ended up where it meant to.

   Two independent facts:
     - `appVariant` — what the build was *declared* as. app.config.js stamps it
       from APP_VARIANT, which eas.json sets per profile.
     - `isProductionDb` — which Supabase project the client *actually* resolved,
       read off the URL in lib/supabase.ts.

   They come from different places on purpose. The variant decides the bundle id
   and the app name; the database comes from EAS environment variables. Nothing
   ties the two together, so they can drift — an env var edited in the EAS
   dashboard, a profile pointed at the wrong `environment`, a stale local .env.
   Comparing them is the only check that catches that, and a mismatch is exactly
   the case worth interrupting someone over. */

import Constants from 'expo-constants';
import { isProductionDb } from './supabase';

export type AppVariant = 'production' | 'staging';

/** What the build says it is. Defaults to staging — see the note in app.config.js. */
export const appVariant: AppVariant =
  Constants.expoConfig?.extra?.appVariant === 'production' ? 'production' : 'staging';

/** A production-labelled build talking to staging, or a staging build on real data. */
export const isEnvMismatch = (appVariant === 'production') !== isProductionDb;

export { isProductionDb };
