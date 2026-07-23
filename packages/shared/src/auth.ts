/* Authentication, shared by both apps.

   Email and password, deliberately. Magic links and OAuth both need a redirect
   path back into the app, and that path is the one genuinely platform-divergent
   piece of the whole system — URL schemes and associated domains on iOS, intent
   filters on Android, a callback route on web. Passwords need none of it, which
   is why 2b ships on all three platforms at once instead of twice.

   Accounts are created by an operator (scripts/onboard-garage.ts), not by
   signup. There is no signUp() here on purpose: a user that exists always has a
   garage_members row, because the same script writes both.

   WHAT THIS IS NOT: a security boundary. Until 2c replaces the demo_all
   policies, the anon key still reads and writes every table, and the anon key
   ships inside both apps. Signing in changes what the app shows, not what the
   database permits. Treat the gate below as product behaviour until 2c lands. */

import type { Session, User } from '@supabase/supabase-js';
import { getClient } from './client';

/** A garage the signed-in user belongs to. Mirrors public.my_garages(). */
export interface Garage {
  id: string;
  name: string;
}

/** What the app needs to decide which screen to render. */
export interface AuthState {
  session: Session | null;
  /** Empty when signed out AND when signed in without a membership — see below. */
  garages: Garage[];
}

export const currentUser = (s: Session | null): User | null => s?.user ?? null;

export const signIn = async (email: string, password: string): Promise<Session> => {
  const { data, error } = await getClient().auth.signInWithPassword({
    email: email.trim(),
    password,
  });
  if (error) throw error;
  if (!data.session) throw new Error('signIn returned no session');
  return data.session;
};

export const signOut = async (): Promise<void> => {
  const { error } = await getClient().auth.signOut();
  if (error) throw error;
};

export const getSession = async (): Promise<Session | null> => {
  const { data, error } = await getClient().auth.getSession();
  if (error) throw error;
  return data.session;
};

/** Fires on sign-in, sign-out and token refresh. Returns an unsubscribe. */
export const onAuthStateChange = (fn: (session: Session | null) => void): (() => void) => {
  const { data } = getClient().auth.onAuthStateChange((_event, session) => fn(session));
  return () => data.subscription.unsubscribe();
};

/* Which garages does the caller belong to?

   Runs under the caller's own RLS, so an unauthenticated caller and a user with
   no membership both get an empty array — and the apps must treat those states
   the same way: refuse to show a board. That distinction is the reason this
   exists rather than current_garage_id(), which answers NULL to both and cannot
   tell a gate why.

   An empty result from a *signed-in* user is not an error to retry. It means an
   account exists that was never joined to a garage, which under operator-created
   accounts should be impossible — so the apps surface it as a support message
   rather than a spinner. */
export const listMyGarages = async (): Promise<Garage[]> => {
  const { data, error } = await getClient().rpc('my_garages');
  if (error) throw error;
  return (data ?? []).map((r: { garage_id: string; garage_name: string }) => ({
    id: r.garage_id,
    name: r.garage_name,
  }));
};

/* ---------- what the apps render, decided once ----------

   Both apps need the same four states and must agree on what produces each,
   because one of them — signed in with no garage — is a rule about what a user
   is allowed to see, not a display preference. If web treated it as "show an
   empty board" and mobile as "show an error", the two would be making different
   claims about the same account.

   This stays framework-free deliberately. Sharing the React hook itself would
   mean adding react to @garage/shared, and mobile is not an npm workspace: its
   dependencies do not hoist, so shared's `react` would resolve to the root copy
   while mobile's components use mobile/node_modules. Two Reacts in one bundle
   is an invalid-hook-call at runtime that typechecks cleanly — the resolution
   risk is worse than the duplication it would save. Each app keeps its own
   thin hook around this. */

export type AuthStatus =
  /** Still reading stored credentials. Never render a login form here. */
  | 'loading'
  /** No session. Login form. */
  | 'out'
  /** Session, and at least one garage. The app. */
  | 'in'
  /** Session, no garage. Not an empty board — see below. */
  | 'no-garage';

export interface ResolvedAuth {
  status: AuthStatus;
  session: Session | null;
  garages: Garage[];
  /** Set only when membership could not be read at all — distinct from having none. */
  error: string | null;
}

export const SIGNED_OUT: ResolvedAuth = {
  status: 'out',
  session: null,
  garages: [],
  error: null,
};

/* Resolve a session into what should be on screen.

   'no-garage' is its own state rather than an empty board because under
   operator-created accounts it should be unreachable: onboard-garage.mjs writes
   the user and the membership together. If it ever appears, something wrote an
   account without a membership, and both alternatives hide that — a spinner
   looks like a slow network, and an empty board looks like a garage with no
   work. Falling through to the board is worse still: before 2c that user reads
   the backfill tenant's data, and after 2c they read nothing while the UI
   insists everything is fine.

   A failure to *read* membership is kept separate from having none. The first
   is a network or policy problem worth retrying; the second is an onboarding
   problem that retrying will never fix, and telling a user to try again when
   the answer will not change wastes their afternoon. */
export const resolveAuth = async (session: Session | null): Promise<ResolvedAuth> => {
  if (!session) return SIGNED_OUT;
  try {
    const garages = await listMyGarages();
    return {
      status: garages.length ? 'in' : 'no-garage',
      session,
      garages,
      error: null,
    };
  } catch (e) {
    return {
      status: 'no-garage',
      session,
      garages: [],
      error: e instanceof Error ? e.message : String(e),
    };
  }
};
