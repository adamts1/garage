// @vitest-environment jsdom
// The module reaches lib/supabase, which builds a client against window on import.
import type { Customer } from '@garage/shared';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { emptyForm, missingRequired, useNewTicket, type TicketForm } from './useNewTicket';

/* Unconfigured, so the hook skips its load-and-subscribe effect. These tests
   are about the form's own rules, not about what the tables contain. */
vi.mock('../../lib/supabase', () => ({ isConfigured: false }));

/* A ticket is the only way a customer gets created, and create_ticket matches
   an existing one by ת״ז then phone. So a ticket saved with a name and nothing
   else used to mint a new customer on every visit — these are the guards that
   stop it at the form. */

const form = (over: Partial<TicketForm>): TicketForm => ({ ...emptyForm, ...over });

const complete = {
  customerName: 'ישראל ישראלי',
  customerPhone: '050-1234567',
  licensePlate: '12-345-67',
};

describe('missingRequired', () => {
  it('accepts a form with a name, a phone and a plate', () => {
    expect(missingRequired(form(complete))).toEqual([]);
  });

  it('lists every empty required field on a blank form', () => {
    expect(missingRequired(emptyForm)).toEqual(['customerName', 'customerPhone', 'licensePlate']);
  });

  it('rejects a name with no phone — the case that duplicated customers', () => {
    expect(missingRequired(form({ ...complete, customerPhone: '' }))).toEqual(['customerPhone']);
  });

  it('rejects a plateless ticket', () => {
    expect(missingRequired(form({ ...complete, licensePlate: '  ' }))).toEqual(['licensePlate']);
  });

  it('rejects a phone too short to call back', () => {
    expect(missingRequired(form({ ...complete, customerPhone: '050' }))).toEqual(['customerPhone']);
  });

  it('counts digits, not punctuation, so a formatted number passes', () => {
    for (const phone of ['050-123-4567', '050 1234567', '0501234567', '02-1234567']) {
      expect(missingRequired(form({ ...complete, customerPhone: phone }))).toEqual([]);
    }
  });

  it('does not require works — a ticket may be opened before the job is known', () => {
    expect(missingRequired(form(complete))).toEqual([]);
  });
});

/* Which record the advisor meant is something only the search box knows: a
   customer saved with no phone cannot be recovered by ת״ז-then-phone matching,
   so picking them and typing a number used to open a second copy. The id now
   rides along — and has to stop riding the moment the form stops describing
   that person. */
describe('the picked customer id', () => {
  const dana: Customer = {
    id: 'cust-1', name: 'דנה', phone: null, id_number: null,
    email: null, address: null, city: null, kind: 'פרטי',
  } as Customer;

  const setup = () =>
    renderHook(() => useNewTicket({ tickets: [], setTickets: vi.fn(), onDone: vi.fn() }));

  it('is set by picking a match, alongside the details it fills in', () => {
    const { result } = setup();
    act(() => result.current.pickCustomer(dana));
    expect(result.current.form.customerId).toBe('cust-1');
    expect(result.current.form.customerName).toBe('דנה');
  });

  it('is dropped when the name, the phone or the ת״ז is typed over', () => {
    for (const field of ['customerName', 'customerPhone', 'idNumber'] as const) {
      const { result } = setup();
      act(() => result.current.pickCustomer(dana));
      act(() => result.current.set(field, 'משהו אחר'));
      expect(result.current.form.customerId).toBeNull();
    }
  });

  it('survives editing a detail of that same person', () => {
    const { result } = setup();
    act(() => result.current.pickCustomer(dana));
    act(() => result.current.set('address', 'הרצל 1'));
    act(() => result.current.set('licensePlate', '12-345-67'));
    expect(result.current.form.customerId).toBe('cust-1');
  });
});
