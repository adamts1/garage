// @vitest-environment jsdom
/* What the intake form does with a number that is already somebody's.
 *
 * The two numbers are not the same kind of thing and must not be treated the
 * same way, which is the whole point of this file:
 *
 *   - a PHONE is shared in real life. A couple, a company line, a parent
 *     paying for a student's car. The form says whose it is and offers to
 *     attach the ticket to them; declining and saving opens a second customer
 *     on the same number, which used to be impossible — create_ticket resolved
 *     by phone and silently attached the ticket to whoever held it first.
 *
 *   - a ת״ז is unique per garage (customers_garage_id_number_key). It cannot be
 *     written onto a second person, and create_ticket sooner drops it than lose
 *     the ticket to a constraint — so saving anyway records a ticket carrying a
 *     number belonging to somebody else. The form refuses until the advisor
 *     either attaches the ticket to the holder or corrects the number.
 */
import type { Customer } from '@garage/shared';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const listCustomers = vi.fn();

vi.mock('@garage/shared', async (importActual) => {
  const actual = await importActual<typeof import('@garage/shared')>();
  return {
    ...actual,
    listCustomers: (...a: unknown[]) => listCustomers(...a),
    listVehicles: vi.fn(async () => []),
    subscribeToTable: vi.fn(() => () => {}),
  };
});

vi.mock('../../lib/supabase', () => ({ isConfigured: true }));

const { useNewTicket } = await import('./useNewTicket');

const customer = (over: Partial<Customer>): Customer =>
  ({
    id: 'x', name: 'x', phone: null, email: null, address: null, city: null,
    kind: 'private', id_number: null, ...over,
  }) as Customer;

const DANA = customer({ id: 'dana', name: 'דנה כהן', phone: '052-111-2233', id_number: '311111111' });

const setup = async (rows: Customer[] = [DANA]) => {
  listCustomers.mockResolvedValue(rows);
  const onDone = vi.fn();
  const view = renderHook(() => useNewTicket({ tickets: [], setTickets: vi.fn(), onDone }));
  // The hook loads the customer list in an effect; the rules below are about it.
  await waitFor(() => expect(listCustomers).toHaveBeenCalled());
  return { ...view, onDone };
};

/** Everything a ticket needs apart from the customer's own numbers. */
const fillTheRest = (set: (k: never, v: never) => void) => {
  const put = set as unknown as (k: string, v: unknown) => void;
  put('customerName', 'עופר כהן');
  put('licensePlate', '12-345-67');
  put('manufacturer', 'טויוטה');
  put('km', '88900');
  put('keyReceived', true);
};

describe('a phone somebody else answers', () => {
  it('is reported, naming the holder', async () => {
    const { result } = await setup();
    act(() => result.current.set('customerPhone', '0521112233'));

    await waitFor(() => expect(result.current.conflict?.customer.name).toBe('דנה כהן'));
    expect(result.current.conflict?.differentName).toBe(true);
  });

  /* The case the old rule could not represent: two customers, one line. */
  it('does not stop the ticket being saved', async () => {
    const { result, onDone } = await setup();
    act(() => {
      fillTheRest(result.current.set);
      result.current.set('customerPhone', '0521112233');
    });

    await waitFor(() => expect(result.current.conflict).not.toBeNull());
    expect(result.current.canSave).toBe(true);

    let saved: boolean | undefined;
    act(() => { saved = result.current.submit(); });
    expect(saved).toBe(true);
    expect(onDone).toHaveBeenCalled();
  });

  it('is answered by attaching the ticket to the holder', async () => {
    const { result } = await setup();
    act(() => result.current.set('customerPhone', '0521112233'));
    await waitFor(() => expect(result.current.conflict).not.toBeNull());

    act(() => result.current.adoptConflict());

    expect(result.current.form.customerId).toBe('dana');
    expect(result.current.conflict).toBeNull();
  });
});

describe('a ת״ז somebody else holds', () => {
  it('refuses the save — it cannot be written onto a second person', async () => {
    const { result } = await setup();
    act(() => {
      fillTheRest(result.current.set);
      result.current.set('customerPhone', '054-999-8877');   // a number of their own
      result.current.set('idNumber', '311111111');
    });

    await waitFor(() => expect(result.current.idConflict?.customer.name).toBe('דנה כהן'));
    expect(result.current.canSave).toBe(false);

    let saved: boolean | undefined;
    act(() => { saved = result.current.submit(); });
    expect(saved).toBe(false);
  });

  it('lets the ticket through once it is attached to the holder', async () => {
    const { result } = await setup();
    act(() => {
      fillTheRest(result.current.set);
      result.current.set('idNumber', '311111111');
    });
    await waitFor(() => expect(result.current.idConflict).not.toBeNull());

    act(() => result.current.adoptIdConflict());

    expect(result.current.form.customerId).toBe('dana');
    expect(result.current.idConflict).toBeNull();
    expect(result.current.canSave).toBe(true);
  });

  /* The other way out, and the one that matters when it was a typo: the number
     is wrong, not the customer. */
  it('lets the ticket through once the number is corrected', async () => {
    const { result } = await setup();
    act(() => {
      fillTheRest(result.current.set);
      result.current.set('customerPhone', '054-999-8877');
      result.current.set('idNumber', '311111111');
    });
    await waitFor(() => expect(result.current.idConflict).not.toBeNull());

    act(() => result.current.set('idNumber', '322222222'));

    expect(result.current.idConflict).toBeNull();
    expect(result.current.canSave).toBe(true);
  });

  it('says nothing when the ת״ז is blank, which most walk-ins leave it', async () => {
    const { result } = await setup();
    act(() => fillTheRest(result.current.set));
    act(() => result.current.set('customerPhone', '054-999-8877'));

    expect(result.current.idConflict).toBeNull();
    expect(result.current.canSave).toBe(true);
  });

  it('says nothing when the number is already on the customer being served', async () => {
    const { result } = await setup();
    act(() => result.current.pickCustomer(DANA));

    expect(result.current.form.idNumber).toBe('311111111');
    expect(result.current.idConflict).toBeNull();
  });
});
