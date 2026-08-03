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

/* An Edge Function returns a non-2xx with a JSON `{error}` body on failure;
   supabase-js surfaces that as a FunctionsHttpError whose real message is in
   error.context. Dig it out so the UI shows "that email already has an account"
   rather than a generic "Edge Function returned a non-2xx status code".

   Lives here rather than beside one caller: every function this app invokes
   fails the same way, and the second caller is how a private helper becomes a
   copy of itself. */
export const invokeError = async (error: any): Promise<Error> => {
  try {
    const body = await error?.context?.json?.();
    if (body?.error) return new Error(body.error);
  } catch { /* fall through to the generic message */ }
  return new Error(error?.message ?? 'the request failed');
};
