/* What updateTicket actually sends.

   A field that both apps now show and let somebody edit has to survive the
   save. `vehicle_code` did not: it is a tickets column, create_ticket wrote it,
   and the update mapper had never carried it — so editing it looked like it
   worked, the screen showed the new value until the next refresh, and the
   database kept the old one. That failure leaves no error to notice.

   This asserts the payload rather than the database. Isolation and policies are
   proven against a real one in supabase/tests/tenancy.mjs; what a stub is good
   for is catching a column that quietly stopped being written. */

import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { setSupabaseClient } from './client';
import { updateTicket } from './db';
import type { Ticket } from './types';

const captureUpdate = () => {
  const sent: Record<string, unknown>[] = [];
  const from = () => {
    const chain: any = {
      update: (payload: Record<string, unknown>) => {
        sent.push(payload);
        return chain;
      },
      eq: () => Promise.resolve({ error: null }),
    };
    return chain;
  };
  setSupabaseClient({ from } as unknown as SupabaseClient);
  return sent;
};

const ticket: Ticket = {
  k: 'GAR-12', st: 'done', type: 'job', epic: 'service', prio: 'high', pts: 3,
  who: 'dk', job: 'W-4', title: 'רעש', plate: '12-345-67', car: 'מאזדה 3',
  customer: 'יוסי לוי', amount: 590, done: 0, subtasks: [], due: '-', flags: [],
  km: '180000', year: '2005', vehicleCode: 'MZ3-2005',
} as Ticket;

describe('updateTicket', () => {
  it('writes the vehicle code back', async () => {
    const sent = captureUpdate();
    await updateTicket(ticket, false);
    expect(sent[0].vehicle_code).toBe('MZ3-2005');
  });

  it('writes the rest of the vehicle alongside it', async () => {
    const sent = captureUpdate();
    await updateTicket(ticket, false);
    expect(sent[0]).toMatchObject({ plate: '12-345-67', car: 'מאזדה 3', km: '180000', year: '2005' });
  });

  /* Cleared, not blanked to an empty string: every other optional column on
     this row is null when it has no value, and two spellings of "nothing" is
     one more than any query wants to know about. */
  it('clears the vehicle code to null rather than an empty string', async () => {
    const sent = captureUpdate();
    await updateTicket({ ...ticket, vehicleCode: '   ' }, false);
    expect(sent[0].vehicle_code).toBeNull();
  });
});
