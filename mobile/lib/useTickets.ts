/* Tickets, backed by Supabase, with optimistic writes.

   saveTicket paints the change immediately, then pushes it. Realtime brings in
   edits made anywhere else (the web board, another phone) — but never while one
   of our own writes is still in flight, or it would flicker back to the old row. */

import { useCallback, useEffect, useRef, useState } from 'react';
import { isConfigured } from './supabase';
import { deleteTicket, listTickets, subscribeToTickets, updateTicket } from './db';
import type { Ticket } from './types';

export function useTickets() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const writing = useRef(0);   // >0 while our own writes are in flight

  const refetch = useCallback(async () => {
    const rows = await listTickets();
    setTickets(rows);
  }, []);

  useEffect(() => {
    if (!isConfigured) { setLoading(false); return; }   // the list screen shows setup instructions

    let alive = true;

    refetch()
      .catch((e) => alive && setError(e.message ?? String(e)))
      .finally(() => alive && setLoading(false));

    const unsubscribe = subscribeToTickets(() => {
      if (writing.current === 0) void refetch().catch(() => {});
    });

    return () => { alive = false; unsubscribe(); };
  }, [refetch]);

  /** Optimistically save one ticket. `worksChanged` skips rewriting works/parts when only fields moved. */
  const saveTicket = useCallback(async (next: Ticket, worksChanged: boolean) => {
    setError(null);
    setTickets((prev) => prev.map((t) => (t.k === next.k ? next : t)));   // paint first

    writing.current++;
    try {
      await updateTicket(next, worksChanged);                            // save second
    } catch (e: any) {
      setError(e.message ?? String(e));
      await refetch().catch(() => {});   // our optimistic state may be a lie now — resync
    } finally {
      writing.current--;
    }
  }, [refetch]);

  const removeTicket = useCallback(async (key: string) => {
    setError(null);
    setTickets((prev) => prev.filter((t) => t.k !== key));

    writing.current++;
    try {
      await deleteTicket(key);
    } catch (e: any) {
      setError(e.message ?? String(e));
      await refetch().catch(() => {});
    } finally {
      writing.current--;
    }
  }, [refetch]);

  return { tickets, loading, error, refetch, saveTicket, removeTicket };
}
