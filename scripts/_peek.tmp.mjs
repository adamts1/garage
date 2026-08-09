import { createClient } from '@supabase/supabase-js';
const db = createClient(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const G = '593e7d33-a6da-496b-824e-4740f9fb70be';
for (const t of ['tickets','customers','vehicles','work_defs','items']) {
  const { data, error } = await db.from(t).select('*').eq('garage_id', G).limit(3);
  console.log(`\n===== ${t}`, error ? error.message : '');
  console.log(JSON.stringify(data, null, 1));
}
