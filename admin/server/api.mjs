/* The console's API: a Vite dev-server middleware, so the whole console is one
 * process started by `npm run admin`.
 *
 * This runs in Node, inside the dev server, and is the only side of the console
 * that ever holds a service_role key. The page in the browser gets JSON — never
 * a key, never a client.
 *
 * Read-only for now: every route is a GET and every route reads. Writes
 * (onboarding a garage) will come through @garage/ops too, behind a typed
 * confirmation of the environment, and will be POSTs that this guard already
 * refuses from any other origin.
 */

import {
  ENVIRONMENTS,
  environment,
  environmentDrift,
  functionsOverview,
  listGarages,
  migrationStatus,
} from '../../packages/ops/src/index.mjs';

/** A request is served only when it was addressed to this machine by name.
 *  The server binds 127.0.0.1, which keeps the network out; this keeps out a
 *  web page that re-points its own hostname at 127.0.0.1 (DNS rebinding) and
 *  would otherwise be reading these responses as same-origin. */
const LOCAL_HOST = /^(localhost|127\.0\.0\.1)(:\d+)?$/;

function refuse(res, status, message) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({ error: message }));
}

const ROUTES = {
  '/api/environments': async () =>
    ENVIRONMENTS.map(({ id, label, ref, gitRef }) => ({ id, label, ref, gitRef })),
  '/api/garages': async (q) => listGarages(environment(q.get('env')).id),
  '/api/migrations': async (q) => migrationStatus(environment(q.get('env')).id),
  '/api/functions': async () => functionsOverview(),
  '/api/functions/drift': async (q) => {
    const env = environment(q.get('env'));
    if (!env.ref) throw new Error('בסביבה המקומית אין פונקציות פרוסות');
    return environmentDrift(env.id);
  },
};

export function adminApi() {
  return {
    name: 'garage-admin-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        if (!url.pathname.startsWith('/api/')) return next();

        if (!LOCAL_HOST.test(req.headers.host ?? '')) return refuse(res, 403, 'host not allowed');
        const origin = req.headers.origin;
        if (origin && !LOCAL_HOST.test(origin.replace(/^https?:\/\//, ''))) return refuse(res, 403, 'origin not allowed');
        if (req.method !== 'GET') return refuse(res, 405, 'read-only');

        const route = ROUTES[url.pathname];
        if (!route) return refuse(res, 404, 'no such route');
        try {
          const body = await route(url.searchParams);
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.setHeader('Cache-Control', 'no-store');
          res.end(JSON.stringify(body));
        } catch (e) {
          refuse(res, 500, e instanceof Error ? e.message : String(e));
        }
      });
    },
  };
}
