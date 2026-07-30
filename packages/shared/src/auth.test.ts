/* resolveAuth decides what both apps put on screen for a given session.

   These are not tests of Supabase. They pin the product rule that web and
   mobile must agree on — in particular that a signed-in user with no garage is
   its own state, never an empty board. Getting that wrong is not a cosmetic
   bug: before 2c that user reads the backfill tenant's data, and after 2c they
   read nothing while the UI claims everything is fine.

   The stub client is what packages/shared/src/client.ts exists for — no
   network, no project. */

import { beforeEach, describe, expect, it } from 'vitest';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { setSupabaseClient } from './client';
import { garageName, getCurrentGarage, resolveAuth, setCurrentGarage, SIGNED_OUT } from './auth';

type RpcResult = { data: unknown; error: unknown };

/** Minimal stand-in: resolveAuth only ever reaches the client through rpc(). */
const stubClient = (result: RpcResult | (() => RpcResult)) =>
  setSupabaseClient({
    rpc: async () => (typeof result === 'function' ? result() : result),
  } as unknown as SupabaseClient);

// Only the fields resolveAuth passes through; a real Session carries far more.
const session = { user: { id: 'u1' } } as unknown as Session;

describe('resolveAuth', () => {
  beforeEach(() => stubClient({ data: [], error: null }));

  it('no session is signed out, and never touches the database', async () => {
    let called = false;
    stubClient(() => {
      called = true;
      return { data: [], error: null };
    });

    expect(await resolveAuth(null)).toEqual(SIGNED_OUT);
    // A membership lookup for a caller with no session would return nothing
    // anyway, but it is a wasted round trip on every cold start of a signed-out
    // app, and it fires a request that will 401 in the logs.
    expect(called).toBe(false);
  });

  it('a session with a garage is signed in', async () => {
    stubClient({ data: [{ garage_id: 'g1', garage_name: 'מוסך ראשי' }], error: null });

    const auth = await resolveAuth(session);
    expect(auth.status).toBe('in');
    expect(auth.garages).toEqual([{ id: 'g1', name: 'מוסך ראשי' }]);
    expect(auth.error).toBeNull();
  });

  it('a session with NO garage is its own state, not signed in', async () => {
    stubClient({ data: [], error: null });

    const auth = await resolveAuth(session);
    // The assertion that matters: not 'in', so no board renders.
    expect(auth.status).toBe('no-garage');
    expect(auth.garages).toEqual([]);
    // Distinguishable from a lookup that failed — this one will not change on
    // a retry, and telling the user to try again would waste their afternoon.
    expect(auth.error).toBeNull();
  });

  it('a failed membership lookup is no-garage WITH an error, not a crash', async () => {
    stubClient({ data: null, error: { message: 'network unreachable' } });

    const auth = await resolveAuth(session);
    expect(auth.status).toBe('no-garage');
    expect(auth.error).toContain('network unreachable');
    // The session is kept: this is not a wrong password, and signing the user
    // out over a dropped connection would be its own bug.
    expect(auth.session).toBe(session);
  });

  it('multi-garage membership keeps every garage', async () => {
    // current_garage_id() is LIMIT 1 and cannot express this; my_garages()
    // deliberately returns all of them so a chooser is possible later without
    // a schema change.
    stubClient({
      data: [
        { garage_id: 'g1', garage_name: 'מוסך א' },
        { garage_id: 'g2', garage_name: 'מוסך ב' },
      ],
      error: null,
    });

    const auth = await resolveAuth(session);
    expect(auth.status).toBe('in');
    expect(auth.garages).toHaveLength(2);
  });

  it('a null rpc payload is treated as no rows, not a crash', async () => {
    // PostgREST returns null rather than [] for some empty results.
    stubClient({ data: null, error: null });

    const auth = await resolveAuth(session);
    expect(auth.status).toBe('no-garage');
    expect(auth.error).toBeNull();
  });
});

/* The name reaches a customer — on the WhatsApp quote, the printed work order,
   the invoice copy. Showing the wrong one is showing a different business's
   name on a document about someone's car, so what is pinned here is that it
   only ever comes from the resolved session. */
describe('the current garage name', () => {
  beforeEach(() => {
    stubClient({ data: [], error: null });
    setCurrentGarage(null);
  });

  it('is the garage of the signed-in session', async () => {
    stubClient({ data: [{ garage_id: 'g1', garage_name: 'מוסך הרצל' }], error: null });

    await resolveAuth(session);
    expect(getCurrentGarage()).toEqual({ id: 'g1', name: 'מוסך הרצל' });
    expect(garageName()).toBe('מוסך הרצל');
  });

  it('is cleared on sign-out, so the next user never sees the previous garage', async () => {
    stubClient({ data: [{ garage_id: 'g1', garage_name: 'מוסך הרצל' }], error: null });
    await resolveAuth(session);

    await resolveAuth(null);
    expect(getCurrentGarage()).toBeNull();
  });

  it('is cleared when membership cannot be read', async () => {
    stubClient({ data: [{ garage_id: 'g1', garage_name: 'מוסך הרצל' }], error: null });
    await resolveAuth(session);

    stubClient({ data: null, error: { message: 'network unreachable' } });
    await resolveAuth(session);
    expect(getCurrentGarage()).toBeNull();
  });

  it('falls back to the generic word rather than to another garage', () => {
    setCurrentGarage(null);
    expect(garageName()).toBe('מוסך');
    // A row whose name was saved blank must not print as an empty header.
    setCurrentGarage({ id: 'g1', name: '   ' });
    expect(garageName()).toBe('מוסך');
  });

  it('takes the first membership when a user belongs to more than one', async () => {
    stubClient({
      data: [
        { garage_id: 'g1', garage_name: 'מוסך א' },
        { garage_id: 'g2', garage_name: 'מוסך ב' },
      ],
      error: null,
    });

    await resolveAuth(session);
    expect(garageName()).toBe('מוסך א');
  });
});
