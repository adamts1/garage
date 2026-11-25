/* The console's API: a Vite dev-server middleware, so the whole console is one
 * process started by `npm run admin`.
 *
 * This runs in Node, inside the dev server, and is the only side of the console
 * that ever holds a service_role key. The page gets JSON — never a key, never
 * a client. Every route is a thin call into packages/ops; there is no logic
 * here that a script could not reach the same way.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import {
  ENVIRONMENTS,
  environment,
  environmentDrift,
  environmentInfo,
  functionsOverview,
  isEnvId,
  listGarages,
  migrationStatus,
  mobileStatus,
  onboardGarage,
  OnboardingInvalid,
  serviceClient,
  setInvoicingActive,
} from '../../packages/ops/src/index.ts';
import type { EnvId, OnboardingInput } from '../../packages/ops/src/types.ts';

/** A request is served only when it was addressed to this machine by name.
 *  The server binds 127.0.0.1, which keeps the network out; this keeps out a
 *  web page that re-points its own hostname at 127.0.0.1 (DNS rebinding) and
 *  would otherwise read these responses as same-origin. */
const LOCAL_HOST = /^(localhost|127\.0\.0\.1)(:\d+)?$/;

/** The page sends this on every write. A cross-site form cannot set a custom
 *  header, and a cross-site fetch that does is stopped by CORS preflight —
 *  so a write can only come from the console's own page. */
export const WRITE_HEADER = 'x-garage-console';

const MAX_BODY = 64 * 1024;

class HttpError extends Error {
  readonly status: number;
  readonly body: Record<string, unknown>;
  constructor(status: number, message: string, extra: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.body = { error: message, ...extra };
  }
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  if (!/^application\/json\b/.test(req.headers['content-type'] ?? '')) throw new HttpError(415, 'JSON only');
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_BODY) throw new HttpError(413, 'body too large');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'invalid JSON');
  }
}

const envParam = (q: URLSearchParams): EnvId => {
  const id = q.get('env');
  if (!isEnvId(id)) throw new HttpError(400, `unknown environment: ${String(id)}`);
  return id;
};

type Get = (q: URLSearchParams) => Promise<unknown>;
type Post = (body: unknown) => Promise<unknown>;

const GET: Record<string, Get> = {
  '/api/environments': async () => ENVIRONMENTS.map(environmentInfo),
  '/api/garages': async (q) => listGarages(envParam(q)),
  '/api/migrations': async (q) => migrationStatus(envParam(q)),
  '/api/functions': async () => functionsOverview(),
  '/api/functions/drift': async (q) => {
    const env = environment(envParam(q));
    if (!env.ref) throw new HttpError(400, 'local has no deployed functions');
    return environmentDrift(env.id);
  },
  '/api/mobile': async () => mobileStatus(),
};

const POST: Record<string, Post> = {
  /* Invoicing on or off for one garage. Production needs its name typed —
     checked here, not only on the page: switching a live garage off means
     its next receipts are not issued. */
  '/api/invoicing': async (body) => {
    const b = body as { env?: unknown; garageId?: unknown; active?: unknown; confirmEnv?: unknown };
    if (!isEnvId(b?.env)) throw new HttpError(400, 'unknown environment');
    if (typeof b.garageId !== 'string' || !/^[0-9a-f-]{36}$/i.test(b.garageId)) throw new HttpError(400, 'garageId is not an id');
    if (typeof b.active !== 'boolean') throw new HttpError(400, 'active must be true or false');
    if (b.env === 'production' && b.confirmEnv !== 'production') throw new HttpError(400, 'type "production" to confirm');
    const { db } = await serviceClient(b.env);
    return setInvoicingActive(db, b.garageId, b.active);
  },
  /* The body is checked again in ops (validateOnboarding) whatever the page
     did — the page's own checks are for the person typing, not a guard. */
  '/api/onboard': async (body) => {
    const input = body as OnboardingInput;
    if (!isEnvId(input?.env)) throw new HttpError(400, 'unknown environment');
    try {
      return await onboardGarage(await serviceClient(input.env), input);
    } catch (e) {
      if (e instanceof OnboardingInvalid) throw new HttpError(422, e.message, { fields: e.errors });
      throw e;
    }
  },
};

export function adminApi(): Plugin {
  return {
    name: 'garage-admin-api',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        if (!url.pathname.startsWith('/api/')) return next();

        void (async () => {
          try {
            if (!LOCAL_HOST.test(req.headers.host ?? '')) throw new HttpError(403, 'host not allowed');
            const origin = req.headers.origin;
            if (origin && !LOCAL_HOST.test(origin.replace(/^https?:\/\//, ''))) throw new HttpError(403, 'origin not allowed');

            if (req.method === 'GET') {
              const route = GET[url.pathname];
              if (!route) throw new HttpError(404, 'no such route');
              return send(res, 200, await route(url.searchParams));
            }
            if (req.method === 'POST') {
              const route = POST[url.pathname];
              if (!route) throw new HttpError(404, 'no such route');
              if (req.headers[WRITE_HEADER] !== '1') throw new HttpError(403, 'missing console header');
              return send(res, 200, await route(await readJson(req)));
            }
            throw new HttpError(405, 'method not allowed');
          } catch (e) {
            if (e instanceof HttpError) return send(res, e.status, e.body);
            send(res, 500, { error: e instanceof Error ? e.message : String(e) });
          }
        })();
      });
    },
  };
}
