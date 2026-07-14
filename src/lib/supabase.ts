import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    'חסרים פרטי חיבור ל-Supabase. צור קובץ .env.local עם VITE_SUPABASE_URL ו-VITE_SUPABASE_ANON_KEY (ראה .env.local.example).',
  );
}

export const supabase = createClient(url, anonKey, {
  realtime: { params: { eventsPerSecond: 10 } },
});
