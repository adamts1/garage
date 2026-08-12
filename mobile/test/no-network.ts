/* No mobile test reaches the network either. See src/test/no-network.ts in the
   web app for the reasoning in full; this is the same guard on the other side of
   the workspace.
 *
 * The phone app cannot issue an invoice — there is no such screen — but it
 * writes tickets, customers, vehicles and photos through the same @garage/shared
 * data layer and the same injected client. A test that gained a live one would
 * write into whatever project mobile/.env points at, and both apps read the same
 * garages. The rule is the same on both sides so that neither has to be the one
 * anybody remembers. */

const PRODUCTION_PROJECT_REF = 'fdztfosbohiwskzfvwaj';

for (const [name, value] of Object.entries(process.env ?? {})) {
  if (typeof value === 'string' && value.includes(PRODUCTION_PROJECT_REF)) {
    throw new Error(
      `Refusing to run the mobile test suite: ${name} names the production project ` +
        `(${PRODUCTION_PROJECT_REF}). Point it at staging or local and run again.`,
    );
  }
}

const blocked = (what: string) => (...args: unknown[]): never => {
  const target = typeof args[0] === 'string' ? args[0] : String((args[0] as { url?: string })?.url ?? '');
  throw new Error(
    `${what} is blocked in tests${target ? ` (tried: ${target})` : ''}. ` +
      'A test must not reach a real project. Mock the module you are testing, ' +
      'or stub this global deliberately with vi.stubGlobal.',
  );
};

// Rejected rather than thrown, so an HTTP client reports it instead of hanging.
globalThis.fetch = ((...args: unknown[]) => {
  try {
    blocked('fetch')(...args);
    return Promise.reject(new Error('unreachable'));
  } catch (e) {
    return Promise.reject(e);
  }
}) as unknown as typeof fetch;

globalThis.WebSocket = class {
  constructor(url: string) {
    blocked('WebSocket')(url);
  }
} as unknown as typeof WebSocket;

globalThis.XMLHttpRequest = class {
  open(_method: string, url: string) {
    blocked('XMLHttpRequest')(url);
  }
} as unknown as typeof XMLHttpRequest;
