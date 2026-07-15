/* Tickets, backed by Supabase, exposed with the exact `[tickets, setTickets]`
   signature the components already use.

   setTickets updates the screen immediately, then diffs old vs. new state and
   pushes only what actually changed. Realtime brings in everyone else's edits. */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Ticket } from '../board-data';
import { isConfigured } from './supabase';
import {
  createTicket, deleteTicket, findOrCreateCustomer, listTickets, subscribeToTickets, updateTicket,
} from './db';

type Setter = (update: Ticket[] | ((prev: Ticket[]) => Ticket[])) => void;

export function useTickets() {
  const [tickets, setLocal] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const current = useRef<Ticket[]>([]);   // what we last showed - the base for the next diff
  const writing = useRef(0);              // >0 while our own writes are in flight

  const refetch = useCallback(async () => {
    const rows = await listTickets();
    current.current = rows;
    setLocal(rows);
  }, []);

  useEffect(() => {
    if (!isConfigured) { setLoading(false); return; }   // App shows the setup screen instead

    let alive = true;

    refetch()
      .catch((e) => alive && setError(e.message ?? String(e)))
      .finally(() => alive && setLoading(false));

    // someone else changed something - pull it in, unless we're mid-write ourselves
    const unsubscribe = subscribeToTickets(() => {
      if (writing.current === 0) void refetch().catch(() => {});
    });

    return () => { alive = false; unsubscribe(); };
  }, [refetch]);

  const persist = useCallback(async (prev: Ticket[], next: Ticket[]) => {
    const before = new Map(prev.map((t) => [t.k, t]));
    const after = new Map(next.map((t) => [t.k, t]));

    writing.current++;
    try {
      for (const [k, t] of after) {
        const old = before.get(k);
        if (!old) {
          await createTicket(t, await findOrCreateCustomer(t));
        } else if (JSON.stringify(old) !== JSON.stringify(t)) {
          const worksChanged = JSON.stringify(old.works ?? []) !== JSON.stringify(t.works ?? []);
          await updateTicket(t, worksChanged);
        }
      }
      for (const k of before.keys()) {
        if (!after.has(k)) await deleteTicket(k);
      }
    } catch (e: any) {
      setError(e.message ?? String(e));
      await refetch().catch(() => {});   // our optimistic state may be a lie now - resync
    } finally {
      writing.current--;
    }
  }, [refetch]);

  const setTickets: Setter = useCallback((update) => {
    const prev = current.current;
    const next = typeof update === 'function' ? update(prev) : update;
    current.current = next;
    setLocal(next);          // paint first
    void persist(prev, next); // save second
  }, [persist]);

  return { tickets, setTickets, loading, error, refetch };
}
