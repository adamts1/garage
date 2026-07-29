/* Tickets, backed by Supabase, with optimistic writes.

   saveTicket paints the change immediately, then pushes it. Realtime brings in
   edits made anywhere else (the web board, another phone) - but never while one
   of our own writes is still in flight, or it would flicker back to the old row. */

import { useCallback, useEffect, useRef, useState } from 'react';
import { isConfigured } from './supabase';
import { createTicket, deleteTicket, listTickets, subscribeToTickets, updateTicket } from '@garage/shared';
import type { Ticket } from '@garage/shared';

export function useTickets() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const writing = useRef(0);   // >0 while our own writes are in flight
  const pending = useRef(false); // a realtime change arrived mid-write, deferred not dropped

  const refetch = useCallback(async () => {
    const rows = await listTickets();
    setTickets(rows);
  }, []);

  // One resync point after a write settles: pull a concurrent change that
  // arrived mid-write (or an error that made our optimistic state a lie).
  const settleWrite = useCallback(async () => {
    writing.current--;
    if (writing.current === 0 && pending.current) {
      pending.current = false;
      await refetch().catch(() => {});
    }
  }, [refetch]);

  useEffect(() => {
    if (!isConfigured) { setLoading(false); return; }   // the list screen shows setup instructions

    let alive = true;

    refetch()
      .catch((e) => alive && setError(e.message ?? String(e)))
      .finally(() => alive && setLoading(false));

    const unsubscribe = subscribeToTickets(() => {
      // Defer, don't drop: a change arriving mid-write must still be applied once
      // our own write settles, or this phone diverges from the board.
      if (writing.current > 0) { pending.current = true; return; }
      void refetch().catch(() => {});
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
      pending.current = true;   // resync in settleWrite once our writes are done
    } finally {
      await settleWrite();
    }
  }, [settleWrite]);

  /* Create a ticket. Unlike saveTicket, the row is NOT painted first: the server
     assigns the real GAR-/W- numbers (createTicket returns them), and a made-up
     key painted in the meantime would either collide or flash and get replaced.
     So we write, then resync to pull the row back with its true key. Returns the
     assigned key so the caller can open the fresh ticket. */
  const addTicket = useCallback(async (draft: Ticket): Promise<string> => {
    setError(null);
    writing.current++;
    try {
      const { key } = await createTicket(draft);
      await refetch().catch(() => {});   // bring the server row (real key, job, works) into the list
      return key;
    } catch (e: any) {
      setError(e.message ?? String(e));
      throw e;
    } finally {
      await settleWrite();
    }
  }, [refetch, settleWrite]);

  const removeTicket = useCallback(async (key: string) => {
    setError(null);
    setTickets((prev) => prev.filter((t) => t.k !== key));

    writing.current++;
    try {
      await deleteTicket(key);
    } catch (e: any) {
      setError(e.message ?? String(e));
      pending.current = true;
    } finally {
      await settleWrite();
    }
  }, [settleWrite]);

  return { tickets, loading, error, refetch, saveTicket, addTicket, removeTicket };
}
