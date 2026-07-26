/* Tickets, backed by Supabase, exposed with the exact `[tickets, setTickets]`
   signature the components already use.

   setTickets updates the screen immediately, then diffs old vs. new state and
   pushes only what actually changed. Realtime brings in everyone else's edits. */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Ticket } from '@garage/shared';
import { isConfigured } from './supabase';
import {
  createTicket, deleteTicket, listTickets, subscribeToTickets, updateTicket,
} from '@garage/shared';

type Setter = (update: Ticket[] | ((prev: Ticket[]) => Ticket[])) => void;

export function useTickets() {
  const [tickets, setLocal] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const current = useRef<Ticket[]>([]);   // what we last showed - the base for the next diff
  const writing = useRef(0);              // >0 while our own writes are in flight
  const pending = useRef(false);          // a realtime change arrived mid-write, deferred not dropped

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

    // Someone else changed something. If we're mid-write, defer the pull rather
    // than drop it — otherwise a concurrent edit is lost until an unrelated event
    // happens to trigger the next refetch, and two boards silently diverge.
    const unsubscribe = subscribeToTickets(() => {
      if (writing.current > 0) { pending.current = true; return; }
      void refetch().catch(() => {});
    });

    return () => { alive = false; unsubscribe(); };
  }, [refetch]);

  const persist = useCallback(async (prev: Ticket[], next: Ticket[]) => {
    const before = new Map(prev.map((t) => [t.k, t]));
    const after = new Map(next.map((t) => [t.k, t]));

    writing.current++;
    let created = false;
    try {
      for (const [k, t] of after) {
        const old = before.get(k);
        if (!old) {
          // The server assigns the real GAR-/W- numbers; the key we painted was
          // a client-side guess. createTicket also resolves the customer now.
          await createTicket(t);
          created = true;
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
      pending.current = true;   // our optimistic state may be a lie now - force a resync below
    } finally {
      writing.current--;
      // One resync point, once our own writes have settled:
      //  - created: pull the server-assigned key over the temporary one we painted
      //  - pending: apply a concurrent edit that arrived (or errored) mid-write
      if (writing.current === 0 && (created || pending.current)) {
        pending.current = false;
        await refetch().catch(() => {});
      }
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
