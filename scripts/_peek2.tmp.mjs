import { createClient } from '@supabase/supabase-js';
const db = createClient(process.env.SUPABASE_URL||process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth:{persistSession:false}});
const G='593e7d33-a6da-496b-824e-4740f9fb70be';
const { data } = await db.from('invoices').select('provider_docnum,ticket_key,doc_type,total').eq('garage_id',G);
console.log('invoice ticket_keys:', JSON.stringify(data));
const { data: tk } = await db.from('tickets').select('key,job').eq('garage_id',G).order('key');
console.log('ticket keys:', tk.map(t=>t.key+'/'+t.job).join(', '));
const { data: ph } = await db.from('ticket_photos').select('*').eq('garage_id',G);
console.log('photos:', JSON.stringify(ph));
