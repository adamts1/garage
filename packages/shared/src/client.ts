/* The Supabase client, injected by whichever app is running.

   Web and mobile construct their clients differently and legitimately so —
   mobile needs the AsyncStorage adapter and `detectSessionInUrl: false`, the
   browser needs neither. Rather than force one shape on both, each app builds
   its own client and hands it here at startup; everything in db.ts then works
   against whichever one it was given.

   This also keeps the data layer testable: a test can inject a stub without
   a network or a real project. */

import type { SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null = null;

/** Call once, before anything touches the database. */
export const setSupabaseClient = (c: SupabaseClient) => {
  client = c;
};

export const getClient = (): SupabaseClient => {
  if (!client) {
    throw new Error(
      '@garage/shared: no Supabase client. Call setSupabaseClient() during app startup.',
    );
  }
  return client;
};
