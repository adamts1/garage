/* Startup reads, started as soon as there is a session.

   Without this the first paint waited on two round trips in a row: AuthGate
   resolves the garage membership (my_garages), and only then does App mount
   and start loading tickets, workers and the catalogue. None of those reads
   needs the membership answer — RLS works from the session alone — so they
   start alongside it and App picks up the promises already in flight.

   Each prefetched read is handed out once. A later caller (a refetch, a
   remount) goes to the network as before, so nothing here can serve stale
   data past the first render. */

import { listItems, listTickets, listWorkDefs, listWorkers } from '@garage/shared';

const readers = {
  tickets: listTickets,
  workers: listWorkers,
  workDefs: listWorkDefs,
  items: listItems,
};

type Key = keyof typeof readers;
type Result<K extends Key> = Awaited<ReturnType<(typeof readers)[K]>>;

let inFlight = new Map<Key, Promise<unknown>>();

/** Start every startup read. Called once per signed-in session. */
export function prefetchStartup(): void {
  for (const key of Object.keys(readers) as Key[]) {
    if (inFlight.has(key)) continue;
    const p = readers[key]();
    // Whoever takes the promise reports its failure; one nobody takes must not
    // surface as an unhandled rejection.
    p.catch(() => {});
    inFlight.set(key, p);
  }
}

/** The prefetched read if there is one, otherwise a fresh one. */
export function takePrefetched<K extends Key>(key: K): Promise<Result<K>> {
  const p = inFlight.get(key);
  inFlight.delete(key);
  return (p ?? readers[key]()) as Promise<Result<K>>;
}

/** On sign-out: reads started under one user must never reach the next. */
export function clearPrefetched(): void {
  inFlight = new Map();
}
