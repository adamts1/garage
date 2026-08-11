// photo — the short link a customer taps in WhatsApp.
//
//   GET /functions/v1/photo/k3f9x2m7qb  ->  302 to a freshly signed photo URL
//
// The only function here that runs WITHOUT a session, and deliberately: it is
// called by a customer's phone, from a chat message, and a customer has no
// account. `verify_jwt = false` in config.toml is what allows that, so the share
// code has to carry the whole authorisation on its own — ten random characters,
// one photo, no way to list or enumerate. See the migration for the trade.
//
// It signs on every request rather than storing a URL, which is the point: the
// link in the chat never expires, while the URL it lands on lives for minutes.
//
// service_role, because the row lookup and the signing both have to happen for a
// caller who is nobody. Nothing here takes input except the code, and the code is
// only ever used as an equality filter — there is no garage, ticket or path a
// caller can name.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

/** Long enough to load the image and reload it once; short enough that a URL
 *  pulled out of a browser's history is not a lasting grant. The durable thing
 *  is the share code, not this. */
const SIGNED_URL_TTL_SECONDS = 300;

/** The alphabet in new_photo_share_code(), exactly. Anything else is not a code
 *  we ever issued, so it is rejected before it reaches the database. */
const CODE = /^[a-km-np-z2-9]{10}$/;

const PHOTO_BUCKET = 'ticket-photos';

const notFound = () =>
  new Response('לא נמצא', {
    status: 404,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });

Deno.serve(async (req) => {
  // A link in a chat is a GET. HEAD comes from the previewer that unfurls it.
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return new Response('method not allowed', { status: 405 });
  }

  try {
    // .../functions/v1/photo/<code> — the last non-empty segment.
    const segments = new URL(req.url).pathname.split('/').filter(Boolean);
    const code = segments[segments.length - 1] ?? '';
    if (!CODE.test(code)) return notFound();

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: photo } = await admin
      .from('ticket_photos')
      .select('path')
      .eq('share_code', code)
      .maybeSingle();
    // A deleted photo and a made-up code answer the same way: nothing here.
    if (!photo) return notFound();

    const { data: signed, error } = await admin
      .storage.from(PHOTO_BUCKET)
      .createSignedUrl(photo.path, SIGNED_URL_TTL_SECONDS);
    if (error || !signed?.signedUrl) return notFound();

    // 302, not 301: the target changes on every request, and a permanent
    // redirect is exactly the thing a browser would cache past its expiry.
    return new Response(null, {
      status: 302,
      headers: {
        Location: signed.signedUrl,
        'Cache-Control': 'no-store',
      },
    });
  } catch {
    return notFound();
  }
});
