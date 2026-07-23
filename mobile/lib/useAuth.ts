/* The session, as React state. Mirrors src/lib/useAuth.ts.

   The decision of what each session means lives in @garage/shared (resolveAuth)
   so the two platforms cannot disagree about it. Only the React plumbing is
   duplicated, and deliberately — see the note in packages/shared/src/auth.ts for
   why the hook itself is not shared. */

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

    // On mobile the stored session comes from AsyncStorage, which is genuinely
    // async — unlike the browser's synchronous localStorage, the 'loading'
    // state here is visible on a cold start rather than instantaneous.
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
