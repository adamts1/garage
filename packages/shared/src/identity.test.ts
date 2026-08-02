import { describe, expect, it } from 'vitest';
import {
  customerByPhone, isUsablePhone, phoneConflict, phoneDigits, ticketCustomerKey,
  type CustomerIdentity,
} from './identity';
import type { Ticket } from './types';

const cust = (over: Partial<CustomerIdentity>): CustomerIdentity => ({
  id: 'c1', name: 'רונית לוי', phone: '0521112233', ...over,
});

const ticket = (over: Partial<Ticket>): Ticket => ({
  k: 'GAR-1', st: 'todo', type: 'job', epic: 'service', prio: 'med', pts: 3,
  who: null, job: 'W-1', title: 'x', plate: '-', car: '-', customer: 'רונית לוי',
  amount: 0, done: 0, subtasks: [], due: '-', flags: [], works: [],
  ...over,
} as Ticket);

describe('phoneDigits', () => {
  it('strips everything a human might type between the digits', () => {
    for (const written of ['050-123-4567', '050 123 4567', '(050) 1234567', '050.123.4567']) {
      expect(phoneDigits(written)).toBe('0501234567');
    }
  });

  it('treats null and undefined as empty rather than throwing', () => {
    expect(phoneDigits(null)).toBe('');
    expect(phoneDigits(undefined)).toBe('');
  });
});

describe('isUsablePhone', () => {
  it('accepts an Israeli landline and a mobile', () => {
    expect(isUsablePhone('02-1234567')).toBe(true);
    expect(isUsablePhone('050-123-4567')).toBe(true);
  });

  it('rejects a number too short to call back', () => {
    expect(isUsablePhone('050')).toBe(false);
    expect(isUsablePhone('1')).toBe(false);
    expect(isUsablePhone('')).toBe(false);
  });
});

describe('customerByPhone', () => {
  const customers = [cust({ id: 'a', phone: '0521112233' }), cust({ id: 'b', phone: '0549998877' })];

  it('matches on digits, so punctuation cannot hide a match', () => {
    expect(customerByPhone(customers, '052-111-2233')?.id).toBe('a');
  });

  it('finds nobody for a free number', () => {
    expect(customerByPhone(customers, '0500000000')).toBeUndefined();
  });

  it('refuses to match on a fragment — three digits is not an identity', () => {
    expect(customerByPhone(customers, '052')).toBeUndefined();
  });
});

/* The phone is the identifier, so a number already on file means the ticket is
   about to be attached to whoever holds it. That used to happen silently, with
   the typed name on the card and somebody else's record behind it. */
describe('phoneConflict', () => {
  const holder = cust({ id: 'a', name: 'רונית לוי', phone: '0521112233' });
  const customers = [holder];

  it('is silent when the number is free', () => {
    expect(phoneConflict(customers, { phone: '0500000000', name: 'משה כהן' })).toBeNull();
  });

  it('flags a different name on a number that is taken', () => {
    const c = phoneConflict(customers, { phone: '052-111-2233', name: 'משה כהן' });
    expect(c?.customer.id).toBe('a');
    expect(c?.differentName).toBe(true);
  });

  it('still reports the match when the name agrees, without calling it a mismatch', () => {
    const c = phoneConflict(customers, { phone: '0521112233', name: '  רונית   לוי ' });
    expect(c?.customer.id).toBe('a');
    expect(c?.differentName).toBe(false);
  });

  it('says nothing once that very customer has been picked — that is the resolution', () => {
    expect(
      phoneConflict(customers, { phone: '0521112233', name: 'רונית לוי', pickedId: 'a' }),
    ).toBeNull();
  });

  it('still warns when a different customer was picked', () => {
    const c = phoneConflict(customers, { phone: '0521112233', name: 'משה כהן', pickedId: 'zzz' });
    expect(c?.differentName).toBe(true);
  });

  it('holds its tongue until the number is long enough to judge', () => {
    expect(phoneConflict(customers, { phone: '052', name: 'משה כהן' })).toBeNull();
  });
});

describe('ticketCustomerKey', () => {
  it('keys on the number, so one person typed two ways is one key', () => {
    expect(ticketCustomerKey(ticket({ customer: 'רונית לוי', phone: '052-111-2233' })))
      .toBe(ticketCustomerKey(ticket({ customer: 'רונית', phone: '0521112233' })));
  });

  it('keeps a shared name apart when the numbers differ', () => {
    expect(ticketCustomerKey(ticket({ customer: 'משה כהן', phone: '0521112233' })))
      .not.toBe(ticketCustomerKey(ticket({ customer: 'משה כהן', phone: '0549998877' })));
  });

  it('falls back to the name for a ticket with no number', () => {
    expect(ticketCustomerKey(ticket({ customer: 'מזדמן', phone: undefined }))).toBe('name:מזדמן');
  });

  it('cannot collide a name key with a phone key', () => {
    expect(ticketCustomerKey(ticket({ customer: '0521112233', phone: undefined })))
      .not.toBe(ticketCustomerKey(ticket({ customer: 'מישהו', phone: '0521112233' })));
  });
});
