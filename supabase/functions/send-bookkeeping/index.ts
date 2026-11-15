// send-bookkeeping — emails a finished bookkeeping export to the garage's
// accountant, straight from the server.
//
//   POST { export_id }
//
// WHAT HAPPENS, IN ORDER
//
//   1. The export is looked up through the CALLER's JWT, so it can only ever be
//      one of their own garage's, and it must be `ready`.
//   2. The accountant's address is read from garage_billing. It is set by a
//      garage admin only (set_accountant_email) — the caller cannot name it.
//   3. A send row is written as `sending`. Only one may be in flight per export
//      (a unique index), so a double press sends one email, not two.
//   4. Every file is read from storage and checked: present, not empty, and
//      exactly the size recorded when it was stored. Any failure stops the send
//      — never a partial set.
//   5. The files are zipped (same name and layout as "download all") and sent
//      through Resend: to the accountant, copy and Reply-To to the person who
//      pressed send. The send row's id is Resend's idempotency key.
//   6. The row becomes `sent` with Resend's message id, or `error` with the
//      reason. That row is the history the page shows.
//
// Nothing passes through the browser: it sends an id and gets back an outcome.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { zipSync } from 'https://esm.sh/fflate@0.8.2';
import { BUCKET, exportPath } from '../_shared/bookkeepingFile.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

/* The sending address on the verified domain. Overridable per environment
   without a deploy. */
const FROM = Deno.env.get('BOOKKEEPING_EMAIL_FROM') ?? 'Garagiox <reports@garagiox.com>';

/* Overridable only so a test can point it at a local stand-in. */
const RESEND_API = Deno.env.get('RESEND_API_URL') ?? 'https://api.resend.com';

/* A send that has been `sending` this long did not finish — the function died
   between asking Resend and writing down the answer. It is closed as an error
   saying the outcome is unknown, so it stops blocking the next send; the
   person is told to check the accountant's inbox before sending again. */
const STALE_MINUTES = 10;

const SOFTWARE_LABEL: Record<string, string> = { rivhit: 'ריווחית', hashavshevet: 'חשבשבת' };

/* Same rule as the page's zipName() (src/pages/Reports/bookkeepingZip.ts), so a
   zip downloaded and a zip emailed have the same name — including the 'מוסך'
   fallback for a garage with no name, as garageName() does on the page. Kept in
   step by hand: the two runtimes do not share modules. */
const unsafe = /[\\/:*?"<>|\s\u0000-\u001f]+/g;
function zipName(garage: string, software: string | null, start: string, end: string): string {
  return [garage, software, start, end]
    .filter((p): p is string => Boolean(p && p.trim()))
    .map((p) => p.trim().replace(unsafe, '-').replace(/^-+|-+$/g, ''))
    .join('_') + '.zip';
}

/** Base64 for an attachment, in chunks — spreading a large array into
 *  String.fromCharCode in one call overflows the stack. */
function base64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader) return json({ error: 'unauthorized' }, 401);

    const resendKey = Deno.env.get('RESEND_API_KEY');
    if (!resendKey) return json({ error: 'email sending is not configured on this server (RESEND_API_KEY)' }, 500);

    const url = Deno.env.get('SUPABASE_URL')!;
    const userClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const body = await req.json().catch(() => ({}));
    const exportId = String(body.export_id ?? '');
    if (!exportId) return json({ error: 'export_id is required' }, 400);

    /* 1. Through the caller's JWT: their own garage's export or nothing. */
    const { data: row, error: rErr } = await userClient
      .from('bookkeeping_exports')
      .select('id, garage_id, status, start_date, end_date, files, file_sizes, software')
      .eq('id', exportId)
      .maybeSingle();
    if (rErr) return json({ error: rErr.message }, 400);
    if (!row) return json({ error: 'export not found in your garage' }, 404);
    if (row.status !== 'ready') return json({ error: 'this export is not ready yet' }, 409);

    /* 2. Where it goes — the garage's setting, never the caller's say. */
    const { data: billing } = await admin.from('garage_billing')
      .select('accountant_email').eq('garage_id', row.garage_id).maybeSingle();
    const to = billing?.accountant_email;
    if (!to) return json({ error: "the accountant's email is not set for this garage" }, 400);

    const { data: garage } = await admin.from('garages').select('name').eq('id', row.garage_id).single();
    const { data: { user } } = await userClient.auth.getUser();
    const sender = user?.email ?? null;

    const software = row.software ? SOFTWARE_LABEL[row.software] ?? row.software : null;
    const attachmentName = zipName(garage?.name?.trim() || 'מוסך', software, row.start_date, row.end_date);

    /* Close sends that never finished, so they stop blocking this one. */
    await admin.from('bookkeeping_export_emails')
      .update({
        status: 'error',
        error: "the send did not finish and its outcome is unknown — check the accountant's inbox before sending again",
      })
      .eq('export_id', row.id)
      .eq('status', 'sending')
      .lt('created_at', new Date(Date.now() - STALE_MINUTES * 60_000).toISOString());

    /* 3. The send row, before anything goes out. The unique index refuses a
       second one while this is in flight. */
    const { data: send, error: sErr } = await admin.from('bookkeeping_export_emails').insert({
      export_id: row.id,
      garage_id: row.garage_id,
      to_email: to,
      cc_email: sender,
      sent_by: user?.id ?? null,
      attachment_name: attachmentName,
    }).select('id').single();
    if (sErr || !send) {
      if (sErr?.code === '23505') return json({ error: 'this export is already being sent' }, 409);
      return json({ error: sErr?.message ?? 'could not record the send' }, 500);
    }

    const fail = async (message: string, status = 502) => {
      await admin.from('bookkeeping_export_emails').update({ status: 'error', error: message }).eq('id', send.id);
      return json({ error: message }, status);
    };

    /* Steps 4–6. Anything that throws in here — not only the failures handled
       one by one — closes the send row as an error, so a crash can never leave
       it `sending` and block the next send. */
    try {
      /* 4. Every file, checked. */
      const files: Record<string, Uint8Array> = {};
      const sizes = (row.file_sizes ?? {}) as Record<string, number>;
      for (const name of (row.files ?? ['movein.dat']) as string[]) {
        const { data: blob, error } = await admin.storage.from(BUCKET).download(exportPath(row.garage_id, row.id, name));
        if (error || !blob) return fail(`${name} could not be read from storage: ${error?.message ?? 'missing'}`);
        const bytes = new Uint8Array(await blob.arrayBuffer());
        if (!bytes.byteLength) return fail(`${name} is empty`);
        if (sizes[name] != null && sizes[name] !== bytes.byteLength) {
          return fail(`${name} is ${bytes.byteLength} bytes but ${sizes[name]} were stored — nothing was sent`);
        }
        files[name] = bytes;
      }

      /* 5. One zip, one email. */
      const zip = zipSync(files);
      const garageName = garage?.name ?? '';
      const period = `${row.start_date} – ${row.end_date}`;
      const subject = `קבצי הנהלת חשבונות – ${garageName}${software ? ` – ${software}` : ''} – ${period}`;
      const fileList = Object.keys(files).join(', ');
      const html = `<div dir="rtl" style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6">
  <p>שלום,</p>
  <p>מצורפים קבצי הנהלת החשבונות של <b>${escapeHtml(garageName)}</b> לתקופה <b dir="ltr">${escapeHtml(period)}</b>${
        software ? `, בפורמט <b>${escapeHtml(software)}</b>` : ''}.</p>
  <p>בקובץ המצורף: <span dir="ltr">${escapeHtml(fileList)}</span></p>
  ${sender ? `<p>נשלח על ידי ${escapeHtml(sender)}. תשובה למייל זה תגיע אליו.</p>` : ''}
  <p style="color:#888;font-size:12px">נשלח ממערכת Garagiox</p>
  </div>`;

      let res: Response;
      try {
        res = await fetch(`${RESEND_API}/emails`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${resendKey}`,
            'Content-Type': 'application/json',
            /* The send row's id: if this request is ever repeated, Resend sends
               once. */
            'Idempotency-Key': send.id,
          },
          body: JSON.stringify({
            from: FROM,
            to: [to],
            ...(sender ? { cc: [sender], reply_to: sender } : {}),
            subject,
            html,
            attachments: [{ filename: attachmentName, content: base64(zip) }],
          }),
          signal: AbortSignal.timeout(30_000),
        });
      } catch (e) {
        /* A timeout or a dropped connection: Resend may or may not have sent it.
           Said plainly rather than guessed. */
        return fail(`no answer from the email service — it may or may not have been sent; check the accountant's inbox before sending again (${e instanceof Error ? e.message : String(e)})`);
      }

      const answer = await res.json().catch(() => ({}));
      if (!res.ok) {
        return fail(`the email service refused it: ${answer?.message ?? answer?.name ?? res.status}`);
      }

      /* 6. Done. */
      /* The email is out. Writing that down is retried once: left as
         `sending`, the row would later be closed as "outcome unknown" about
         an email that did go. */
      const markSent = () => admin.from('bookkeeping_export_emails').update({
        status: 'sent',
        provider_id: answer?.id ?? null,
        sent_at: new Date().toISOString(),
        error: null,
      }).eq('id', send.id);
      if ((await markSent()).error) await markSent();

      return json({ sent: true, to, cc: sender, attachment: attachmentName });
    } catch (e) {
      return fail(`the send stopped unexpectedly: ${e instanceof Error ? e.message : String(e)}`, 500);
    }
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
