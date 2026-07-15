import 'react-native-url-polyfill/auto';   // supabase-js needs a real URL/URLSearchParams; RN's is incomplete
import AsyncStorage from '@react-native-async-storage/async-storage';
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
      // There is no login yet, but wiring these now means adding Supabase Auth later
      // is a new screen, not a client rewrite. Sessions survive an app restart.
      storage: AsyncStorage,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,   // no URL bar to read a session out of on mobile
    },
    realtime: { params: { eventsPerSecond: 10 } },
  },
);
