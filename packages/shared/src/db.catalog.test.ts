/* The catalog data layer's mapping and failure handling.

   Isolation is proven against a real database in supabase/tests/tenancy.mjs —
   a stub cannot prove a policy. What a stub can prove is the part that silently
   produces wrong money: numerics arriving as strings, parts coming back in the
   wrong order, and a work that keeps its id after its parts failed to save. */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { setSupabaseClient } from './client';
import { createWorkDef, listWorkDefs } from './db';

/** Records what was asked of the client and replays canned answers. */
const stub = (handlers: Record<string, any>) => {
  const calls: { table: string; op: string; payload?: any }[] = [];

  const from = (table: string) => {
    const chain: any = {
      select: () => chain,
      order: () => handlers[`${table}.select`] ?? { data: [], error: null },
      single: () => handlers[`${table}.insert`] ?? { data: null, error: null },
      eq: (_c: string, v: string) => {
        calls.push({ table, op: 'delete', payload: v });
        return handlers[`${table}.delete`] ?? { data: null, error: null };
      },
      insert: (payload: any) => {
        calls.push({ table, op: 'insert', payload });
        const res = handlers[`${table}.insert`];
        // An insert is awaited directly when no .select() follows it.
        return Object.assign(Promise.resolve(res ?? { data: null, error: null }), chain);
      },
      delete: () => chain,
      update: () => chain,
    };
    return chain;
  };

  setSupabaseClient({ from } as unknown as SupabaseClient);
  return calls;
};

describe('listWorkDefs', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('coerces numerics — Postgres returns them as strings', async () => {
    stub({
      'work_defs.select': {
        data: [
          {
            id: 'w1', code: 'OIL-01', name: 'oil',
            // numeric(10,2) arrives over PostgREST as a string
            labor: '120.00', hours: '1.00',
            work_def_items: [{ sku: 'A', name: 'a', qty: '5.00', price: '45.00', position: 0 }],
          },
        ],
        error: null,
      },
    });

    const [w] = await listWorkDefs();
    expect(typeof w.labor).toBe('number');
    expect(w.labor).toBe(120);
    expect(typeof w.items[0].price).toBe('number');
    expect(w.items[0].qty).toBe(5);
    // A string here reaches the invoice arithmetic and '120' + 5 is '1205'.
  });

  it('orders parts by position, not by whatever PostgREST returned', async () => {
    stub({
      'work_defs.select': {
        data: [
          {
            id: 'w1', code: 'C', name: 'n', labor: 0, hours: 0,
            work_def_items: [
              { sku: 'THIRD', name: 'c', qty: 1, price: 1, position: 2 },
              { sku: 'FIRST', name: 'a', qty: 1, price: 1, position: 0 },
              { sku: 'SECOND', name: 'b', qty: 1, price: 1, position: 1 },
            ],
          },
        ],
        error: null,
      },
    });

    const [w] = await listWorkDefs();
    expect(w.items.map((i) => i.sku)).toEqual(['FIRST', 'SECOND', 'THIRD']);
    // An embedded select carries no order guarantee; the mechanic's parts list
    // reordering itself between page loads looks like data loss.
  });

  it('a work with no parts is empty, not undefined', async () => {
    stub({
      'work_defs.select': {
        data: [{ id: 'w1', code: 'DIA-01', name: 'diag', labor: 150, hours: 1, work_def_items: [] }],
        error: null,
      },
    });

    const [w] = await listWorkDefs();
    expect(w.items).toEqual([]);
  });

  it('propagates an error rather than returning an empty catalog', async () => {
    stub({ 'work_defs.select': { data: null, error: { message: 'permission denied' } } });
    // An empty catalog and a refused one look identical in the UI, and the
    // first invites someone to re-enter ten works by hand.
    await expect(listWorkDefs()).rejects.toBeTruthy();
  });
});

describe('createWorkDef', () => {
  it('never sends garage_id — the column defaults to the caller"s garage', async () => {
    const calls = stub({
      'work_defs.insert': { data: { id: 'new' }, error: null },
      'work_def_items.insert': { data: null, error: null },
    });

    await createWorkDef({ code: 'X', name: 'x', labor: 1, hours: 1, items: [] });

    const insert = calls.find((c) => c.table === 'work_defs' && c.op === 'insert');
    expect(insert?.payload).toBeDefined();
    expect('garage_id' in insert!.payload).toBe(false);
    // Sending it would let a caller aim a row at another tenant; the default
    // and the WITH CHECK policy are what make that unrepresentable.
  });

  it('removes the work when its parts fail to save', async () => {
    const calls = stub({
      'work_defs.insert': { data: { id: 'orphan' }, error: null },
      'work_def_items.insert': { data: null, error: { message: 'nope' } },
      'work_defs.delete': { data: null, error: null },
    });

    await expect(
      createWorkDef({ code: 'X', name: 'x', labor: 1, hours: 1, items: [{ sku: 'p', name: 'p', qty: 1, price: 1 }] }),
    ).rejects.toBeTruthy();

    // Otherwise the catalog keeps a work that lost its parts — it looks right
    // in the list and quotes wrong the moment someone picks it.
    expect(calls.some((c) => c.table === 'work_defs' && c.op === 'delete' && c.payload === 'orphan')).toBe(true);
  });
});
