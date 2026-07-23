import 'react-native-url-polyfill/auto';   // supabase-js needs a real URL/URLSearchParams; RN's is incomplete
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
import { createClient } from '@supabase/supabase-js';

// Same normalisation as the web app: supabase-js appends /rest/v1 and /realtime/v1
// itself, so it wants the bare project URL. Trim any path pasted from the dashboard.
const url = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? '')
  .trim()
  .replace(/\/(rest|auth|realtime|storage)\/v1\/?$/, '')
  .replace(/\/+$/, '');
const anonKey = (process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '').trim();

/** False until .env is filled in - the app shows setup instructions instead of an empty list. */
export const isConfigured = Boolean(url && anonKey && !url.includes('YOUR-PROJECT-REF'));

// A placeholder URL keeps createClient from throwing at import time; nothing calls it while unconfigured.
export const supabase = createClient(
  isConfigured ? url : 'https://placeholder.supabase.co',
  isConfigured ? anonKey : 'placeholder-key',
  {
    auth: {
      // Sessions survive an app restart; see the AppState note below for the
      // part that keeps them alive while the app is not on screen.
      storage: AsyncStorage,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,   // no URL bar to read a session out of on mobile
    },
    realtime: { params: { eventsPerSecond: 10 } },
  },
);

/* Refresh tokens only while the app is actually in the foreground.

   autoRefreshToken sets a timer, and the OS does not run timers for a
   backgrounded app. Without this, a phone left on a bench overnight — which is
   the normal state of a phone in a garage — resumes with an access token that
   expired hours ago, and the first tap gets a 401 that looks like a random
   failure rather than an expired session.

   Stopping on background matters as much as starting on foreground: a timer
   left armed fires on wake in an unpredictable order relative to the resumed
   session read, and can refresh with a token AsyncStorage has already replaced.

   Registered once at module scope, alongside the client it refreshes, rather
   than in a component that could mount twice. */
AppState.addEventListener('change', (state) => {
  if (state === 'active') {
    void supabase.auth.startAutoRefresh();
  } else {
    void supabase.auth.stopAutoRefresh();
  }
});
