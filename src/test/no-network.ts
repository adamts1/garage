/* No test reaches the network. Not staging, and above all not production.
 *
 * WHAT THIS IS PROTECTING AGAINST
 *
 * One click of "issue" in this app creates a real tax document at the garage's
 * real accounting provider, against a real customer, with a legal number
 * allocated by the tax authority. There is no sandbox in the provider adapter:
 * whichever database the app is pointed at is where the document is issued, and
 * the only undo is a credit note, which is itself a real document a customer
 * receives.
 *
 * Nothing in the suite does that today — @garage/shared holds no client of its
 * own, so `getClient()` throws until an app injects one, and the tests inject
 * stubs. But that is a property of every test as written, and it has to hold for
 * every test that will ever be written. One `setSupabaseClient(supabase)` copied
 * out of main.tsx into a test file would quietly hand the whole suite a live
 * client, pointed whereever `.env.local` happens to point that week.
 *
 * So the guarantee is moved off convention and onto the runtime: in a test
 * there is no fetch, no WebSocket and no XMLHttpRequest, so there is no call to
 * make — however the client got there. A test that needs one of them can stub it
 * for itself with `vi.stubGlobal`, which is a deliberate line in a diff rather
 * than an accident.
 *
 * The env check below is the belt to that braces: it catches the case the
 * network block cannot, which is a test that shells out to a script.
 */

/** The garages' real data. Also in mobile/lib/supabase.ts and in the deploy
 *  scripts — not a secret, and the one string this file must never be wrong
 *  about. */
const PRODUCTION_PROJECT_REF = 'farpgkljbmlaeiocrore';

const namesProduction = (value: unknown): boolean =>
  typeof value === 'string' && value.includes(PRODUCTION_PROJECT_REF);

/* Vite loads .env.local into a test run the same way it does into a dev server,
   so whatever a developer has pointed their local app at is what a test would
   have reached. Both bags are checked: import.meta.env carries the VITE_ vars,
   process.env carries everything a shell exported. */
/* Reached through globalThis rather than as the bare `process` global: the web
   app's tsconfig carries no node types, and this file is compiled by the same
   `tsc --noEmit` as the app it guards. */
const shellEnvironment =
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};

const environment: Array<[string, unknown]> = [
  ...Object.entries(import.meta.env ?? {}),
  ...Object.entries(shellEnvironment),
];

for (const [name, value] of environment) {
  if (namesProduction(value)) {
    throw new Error(
      `Refusing to run the test suite: ${name} names the production project ` +
        `(${PRODUCTION_PROJECT_REF}). Point it at staging or local and run again. ` +
        'Nothing here is meant to touch the garages\' real data.',
    );
  }
}

/* Every call that was turned away, in order.
 *
 * On globalThis rather than exported, so a test can read it without importing
 * this module and risking a second copy of it. It is what lets a test assert
 * which endpoint was reached for — some clients (supabase's functions client
 * among them) replace a transport error with a message of their own, and
 * "something failed" is a much weaker claim than "the call to issue-invoice was
 * stopped before it left the process". */
export const BLOCKED_REQUESTS = '__garageBlockedRequests';
(globalThis as Record<string, unknown>)[BLOCKED_REQUESTS] = [] as string[];

/** Replaces a network entry point with one that says why it is gone. */
const blocked = (what: string) => (...args: unknown[]): never => {
  const target = typeof args[0] === 'string' ? args[0] : String((args[0] as { url?: string })?.url ?? '');
  ((globalThis as Record<string, unknown>)[BLOCKED_REQUESTS] as string[]).push(target);
  throw new Error(
    `${what} is blocked in tests${target ? ` (tried: ${target})` : ''}. ` +
      'A test must not reach a real project — issuing an invoice is not reversible. ' +
      'Mock the module you are testing, or stub this global deliberately with vi.stubGlobal.',
  );
};

/* A rejected promise rather than a synchronous throw, because that is what a
   real network failure looks like and what every HTTP client is written to
   handle. Throwing synchronously made supabase-js hang instead of reporting:
   the error escaped outside the promise it was awaiting, and the call never
   settled — a test that times out says far less than one that says why. */
globalThis.fetch = ((...args: unknown[]) => {
  try {
    blocked('fetch')(...args);
    return Promise.reject(new Error('unreachable'));
  } catch (e) {
    return Promise.reject(e);
  }
}) as unknown as typeof fetch;

/* supabase-js does not only use fetch: realtime is a WebSocket, and older
   transports fall back to XMLHttpRequest. Blocking fetch alone would leave the
   subscription path open. */
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
