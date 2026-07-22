/* The session, as React state.

   Three states matter to the UI and they are not the same thing:

     status 'loading'  — we have not yet asked Supabase whether a stored session
                         exists. Rendering a login form here makes the app flash
                         a login screen on every reload for an already-signed-in
                         user, which is the single most visible way to get this
                         wrong.
     status 'out'      — no session. Show the login form.
     status 'in'       — session, plus the garages it belongs to. `garages` may
                         still be empty; see AuthGate for why that is its own
                         screen rather than an error.

   Membership is fetched on every auth change rather than cached across them,
   because a sign-out followed by a different sign-in must not inherit the first
   user's garage. */

import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { getSession, listMyGarages, onAuthStateChange, type Garage } from '@garage/shared';
import { isConfigured } from './supabase';

export type AuthStatus = 'loading' | 'out' | 'in';

export interface Auth {
  status: AuthStatus;
  session: Session | null;
  garages: Garage[];
  /** Set when membership could not be read — distinct from "no membership". */
  error: string | null;
}

export function useAuth(): Auth {
  const [auth, setAuth] = useState<Auth>({
    status: isConfigured ? 'loading' : 'out',
    session: null,
    garages: [],
    error: null,
  });

  useEffect(() => {
    if (!isConfigured) return;
    // Guards against a resolved promise writing state after sign-out raced ahead
    // of it, which would show the previous user's garages on the login screen.
    let live = true;

    const apply = async (session: Session | null) => {
      if (!session) {
        if (live) setAuth({ status: 'out', session: null, garages: [], error: null });
        return;
      }
      try {
        const garages = await listMyGarages();
        if (live) setAuth({ status: 'in', session, garages, error: null });
      } catch (e) {
        // A session we cannot resolve a garage for is not a session we can use,
        // but it is also not a wrong password — say so rather than logging out.
        if (live) {
          setAuth({
            status: 'in',
            session,
            garages: [],
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
    };

    getSession()
      .then(apply)
      .catch(() => live && setAuth({ status: 'out', session: null, garages: [], error: null }));

    const unsubscribe = onAuthStateChange((session) => void apply(session));

    return () => {
      live = false;
      unsubscribe();
    };
  }, []);

  return auth;
}
