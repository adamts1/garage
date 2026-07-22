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
