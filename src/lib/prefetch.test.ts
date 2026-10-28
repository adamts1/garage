import { beforeEach, describe, expect, it, vi } from 'vitest';

/* The contract that matters: a prefetched read is served once, and nothing
   started under one session reaches the next. */

const calls = { tickets: 0, workers: 0, workDefs: 0, items: 0 };

vi.mock('@garage/shared', () => ({
  listTickets: async () => { calls.tickets++; return [`tickets#${calls.tickets}`]; },
  listWorkers: async () => { calls.workers++; return []; },
  listWorkDefs: async () => { calls.workDefs++; return []; },
  listItems: async () => { calls.items++; return []; },
}));

const { clearPrefetched, prefetchStartup, takePrefetched } = await import('./prefetch');

beforeEach(() => {
  clearPrefetched();
  for (const k of Object.keys(calls) as (keyof typeof calls)[]) calls[k] = 0;
});

describe('prefetch', () => {
  it('starts every startup read once, however often it is called', () => {
    prefetchStartup();
    prefetchStartup();
    expect(calls).toEqual({ tickets: 1, workers: 1, workDefs: 1, items: 1 });
  });

  it('serves the prefetched read once, then goes to the network', async () => {
    prefetchStartup();
    expect(await takePrefetched('tickets')).toEqual(['tickets#1']);
    expect(await takePrefetched('tickets')).toEqual(['tickets#2']);
    expect(calls.tickets).toBe(2);
  });

  it('reads fresh when nothing was prefetched', async () => {
    expect(await takePrefetched('tickets')).toEqual(['tickets#1']);
  });

  it('drops reads from a signed-out session', async () => {
    prefetchStartup();
    clearPrefetched();
    expect(await takePrefetched('tickets')).toEqual(['tickets#2']);
  });
});
