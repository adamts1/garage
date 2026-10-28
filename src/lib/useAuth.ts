/* The session, as React state.

   The decision of what each session means lives in @garage/shared (resolveAuth)
   so web and mobile cannot disagree about it. What is here is only the React
   plumbing: subscribe, resolve, set state, clean up. */

import { useEffect, useState } from 'react';
import {
  getSession,
  onAuthStateChange,
  resolveAuth,
  SIGNED_OUT,
  type ResolvedAuth,
} from '@garage/shared';
import { clearPrefetched, prefetchStartup } from './prefetch';
import { isConfigured } from './supabase';

export function useAuth(): ResolvedAuth {
  const [auth, setAuth] = useState<ResolvedAuth>(
    isConfigured ? { ...SIGNED_OUT, status: 'loading' } : SIGNED_OUT,
  );

  useEffect(() => {
    if (!isConfigured) return;

    // Guards a resolved promise from writing state after a sign-out raced past
    // it, which would show the previous user's garages on the login screen.
    let live = true;
    /* getSession and the INITIAL_SESSION event both deliver the stored session
       on load, so without this every page load ran my_garages twice. Keyed on
       the access token: a refresh issues a new one and still re-resolves. */
    let lastToken: string | null | undefined;
    const apply = async (session: Parameters<typeof resolveAuth>[0]) => {
      const token = session?.access_token ?? null;
      if (token === lastToken) return;
      const wasSignedIn = Boolean(lastToken);
      lastToken = token;

      /* Start the board's reads now rather than after my_garages answers. Only
         on the way in — an hourly token refresh must not leave a set of reads
         behind that nobody takes. */
      if (!session) clearPrefetched();
      else if (!wasSignedIn) prefetchStartup();

      const next = await resolveAuth(session);
      if (live) setAuth(next);
    };

    void getSession()
      .then(apply)
      .catch(() => live && setAuth(SIGNED_OUT));

    const unsubscribe = onAuthStateChange((session) => void apply(session));

    return () => {
      live = false;
      unsubscribe();
    };
  }, []);

  return auth;
}
