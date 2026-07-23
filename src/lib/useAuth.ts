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
    const apply = async (session: Parameters<typeof resolveAuth>[0]) => {
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
