import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

/** False until .env.local is filled in — the app shows setup instructions instead of a blank page. */
export const isConfigured = Boolean(url && anonKey && !url.includes('YOUR-PROJECT-REF'));

// A placeholder URL keeps createClient from throwing at import time; nothing calls it while unconfigured.
export const supabase = createClient(
  isConfigured ? url : 'https://placeholder.supabase.co',
  isConfigured ? anonKey : 'placeholder-key',
  { realtime: { params: { eventsPerSecond: 10 } } },
);
