/* The guard that stops a test issuing a real tax document.
 *
 * A setup file that silently stopped applying would look exactly like a passing
 * suite — right up to the afternoon a test hands a customer an invoice nobody
 * meant to issue. So the block is asserted rather than assumed, and asserted
 * from inside an ordinary test file, which is the same position any future test
 * will be written from.
 */

import { describe, expect, it } from 'vitest';
import { setSupabaseClient } from '@garage/shared';
import { BLOCKED_REQUESTS } from './no-network';

describe('the network is unreachable from a test', () => {
  it('refuses fetch, and says why', async () => {
    await expect(fetch('https://example.supabase.co/rest/v1/invoices')).rejects.toThrow(
      /blocked in tests/,
    );
  });

  it('refuses a WebSocket — realtime does not go through fetch', () => {
    expect(() => new WebSocket('wss://example.supabase.co/realtime/v1')).toThrow(/blocked in tests/);
  });

  it('refuses XMLHttpRequest', () => {
    const request = new XMLHttpRequest();
    expect(() => request.open('POST', 'https://example.supabase.co')).toThrow(/blocked in tests/);
  });

  /* The scenario in full, and the exact call that would do the damage.
     Somebody copies the two lines out of main.tsx that hand @garage/shared a
     live client; a test then reaches issue-invoice, which is the one endpoint
     that allocates a legal document number at a garage's provider. It gets as
     far as the fetch and no further.

     An HTTP failure is reported by supabase-js in `error` rather than thrown,
     which is what makes the message worth asserting: it proves the call was
     stopped here rather than failing for some other reason. */
  it('stops a real client on the way to issuing an invoice', async () => {
    const { createClient } = await import('@supabase/supabase-js');
    setSupabaseClient(createClient('https://example.supabase.co', 'anon-key'));

    const { getClient } = await import('@garage/shared');
    const { data, error } = await getClient().functions.invoke('issue-invoice', {
      body: { action: 'issue', ticket_id: 'whatever' },
    });

    // No document, and an error rather than a result.
    expect(data).toBeNull();
    expect(error).toBeTruthy();

    /* And it was stopped here. supabase-js reports its own "failed to send a
       request" in place of the cause, so the record is what shows the call
       never left — and which call it was. */
    const attempted = (globalThis as Record<string, unknown>)[BLOCKED_REQUESTS] as string[];
    expect(attempted.some((url) => url.includes('/functions/v1/issue-invoice'))).toBe(true);

    // Put it back the way every other test expects to find it.
    setSupabaseClient(null as never);
  });
});
