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

/** What a member may do in their garage. Two, and only the one distinction:
 *  who may change the name or price of a work already on a ticket. Assigned by
 *  scripts/onboard-garage.mjs; there is no in-app editor, so nobody can demote
 *  themselves out of their own prices. */
export type GarageRole = 'admin' | 'member';

/** A garage the signed-in user belongs to. Mirrors public.my_garages(). */
export interface Garage {
  id: string;
  name: string;
  role: GarageRole;
}

/** What the app needs to decide which screen to render. */
export interface AuthState {
  session: Session | null;
  /** Empty when signed out AND when signed in without a membership — see below. */
  garages: Garage[];
}

export const currentUser = (s: Session | null): User | null => s?.user ?? null;

/* ---------- the signed-in garage's own name ----------

   Every garage on the system is its own tenant with its own name, given once at
   onboarding:

     npm run onboard -- --garage "מוסך הרצל" --email avi@example.com

   That name is what the apps must show and what a customer must see — on the
   sidebar, on the WhatsApp quote, on the printed work order, on the invoice
   copy. Those all used to read 'מוסך אי-תן', a constant compiled into the
   bundle, which meant every garage on the system introduced itself as the first
   one we onboarded.

   A module-level value rather than React context, because the printed documents
   are built in plain modules and not in components. Same shape as
   setSupabaseClient in client.ts: set once at the edge, read anywhere.

   resolveAuth below is the only writer, so this cannot drift from the session —
   it is populated before any screen that could show it renders, and cleared on
   sign-out so the next user never sees the previous garage's name. */
let currentGarage: Garage | null = null;

export const setCurrentGarage = (g: Garage | null): void => { currentGarage = g; };

export const getCurrentGarage = (): Garage | null => currentGarage;

/* Who is signed in, kept beside the garage above and written by the same
   resolver, so the two can never describe different people.

   The staff screen is what needs it: it has to recognise the caller's own row
   in order not to offer them the control that would take their own admin away.
   Read from a module-level value rather than threaded through props, for the
   same reason garageName() is — the screens that need it are several levels
   down from the gate that resolved the session. */
let currentUserId: string | null = null;

export const getCurrentUserId = (): string | null => currentUserId;

/** Whether the signed-in user may change what a customer is charged.
 *
 *  Read from the same module-level garage as the name above, so it is populated
 *  before any screen that could act on it renders and cleared on sign-out.
 *
 *  This is what the UI reads to decide whether to offer an editable price. It
 *  is NOT the boundary: save_ticket_works re-checks the role in the database,
 *  because a value a client can read is a value a client can lie about. */
export const isGarageAdmin = (): boolean => currentGarage?.role === 'admin';

/** The garage's display name. Falls back to the generic word rather than to
 *  some other garage's name — wrong is worse than plain on a customer's quote. */
export const garageName = (): string => currentGarage?.name?.trim() || 'מוסך';

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
  return (data ?? []).map((r: { garage_id: string; garage_name: string; role: string }) => ({
    id: r.garage_id,
    name: r.garage_name,
    // Anything unrecognised is the lesser privilege. A role this build has not
    // heard of must not read as admin.
    role: r.role === 'admin' ? 'admin' : 'member',
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
  if (!session) {
    setCurrentGarage(null);
    currentUserId = null;
    return SIGNED_OUT;
  }
  currentUserId = session.user?.id ?? null;
  try {
    const garages = await listMyGarages();
    /* The first membership is the garage the apps present as "this garage".
       Belonging to two is possible in the schema and no screen offers a
       switcher yet, so picking [0] is a decision to revisit the day one does —
       not an assumption that the array is always length 1. */
    setCurrentGarage(garages[0] ?? null);
    return {
      status: garages.length ? 'in' : 'no-garage',
      session,
      garages,
      error: null,
    };
  } catch (e) {
    setCurrentGarage(null);
    return {
      status: 'no-garage',
      session,
      garages: [],
      error: errorMessage(e),
    };
  }
};

/* Supabase rejects with a PostgrestError — a plain object with a `message`,
   not an Error instance. `String(e)` on one yields "[object Object]", which is
   what reaches Sentry and, in the app, the operator on the phone. */
const errorMessage = (e: unknown): string => {
  if (e instanceof Error) return e.message;
  if (typeof e === 'object' && e !== null && 'message' in e) {
    return String((e as { message: unknown }).message);
  }
  return String(e);
};
