import { createClient } from '@supabase/supabase-js';

// supabase-js appends /rest/v1 and /realtime/v1 itself — it wants the bare project URL.
// Copying the REST endpoint from the dashboard is an easy mistake, so trim any path off.
const url = (import.meta.env.VITE_SUPABASE_URL ?? '').trim().replace(/\/(rest|auth|realtime|storage)\/v1\/?$/, '').replace(/\/+$/, '');
const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim();

/** False until .env.local is filled in — the app shows setup instructions instead of a blank page. */
export const isConfigured = Boolean(url && anonKey && !url.includes('YOUR-PROJECT-REF'));

// A placeholder URL keeps createClient from throwing at import time; nothing calls it while unconfigured.
export const supabase = createClient(
  isConfigured ? url : 'https://placeholder.supabase.co',
  isConfigured ? anonKey : 'placeholder-key',
  { realtime: { params: { eventsPerSecond: 10 } } },
);
