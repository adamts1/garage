// Stands in for iCount in supabase/tests/billing/race.mjs. Never point a hosted project at it.
// A stand-in for iCount: counts doc/create calls; its mode decides how it answers.
import http from 'node:http';
let mode = 'ok', delayMs = 0, docnum = 5000;
const creates = [];
http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', async () => {
    const send = (code, obj, raw) => { res.writeHead(code, { 'Content-Type': raw ? 'text/html' : 'application/json' }); res.end(raw ?? JSON.stringify(obj)); };
    if (req.url === '/__mode') { ({ mode, delayMs = 0 } = JSON.parse(body)); creates.length = 0; return send(200, { ok: true }); }
    if (req.url === '/__creates') return send(200, creates);
    const path = req.url.replace(/^\/api\/v3\.php\//, '');
    if (path === 'doc/info') return send(200, { status: true, doc_info: {} });
    if (path !== 'doc/create') return send(200, { status: true });
    const parsed = JSON.parse(body);
    if (mode === 'refuse') return send(200, { status: false, reason: 'refused by fake' });
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    const n = String(++docnum);
    creates.push({ docnum: n, doctype: parsed.doctype });
    if (mode === 'created_then_html') return send(502, null, '<html>bad gateway</html>');   // created, but the answer is lost
    return send(200, { status: true, docnum: n, doc_url: `https://fake/${n}.pdf` });
  });
}).listen(8787, () => console.log('fake iCount on 8787'));
