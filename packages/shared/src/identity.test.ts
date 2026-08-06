import { describe, expect, it } from 'vitest';
import { CUSTOMER_MATCH_LIMIT, customerByPhone, customerKind, isBusinessCustomer, isUsablePhone, matchCustomers, phoneConflict, phoneDigits, ticketCustomerKey, type CustomerIdentity } from './identity';
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

/* One filter, used by both intake forms. It was two copies, which is how the
   web and the phone come to disagree about who a search finds. */
describe('matchCustomers', () => {
  const customers = [
    cust({ id: 'a', name: 'רונית לוי', phone: '052-111-2233' }),
    cust({ id: 'b', name: 'משה כהן', phone: '0549998877' }),
    cust({ id: 'c', name: 'רונית ברק', phone: null }),
  ];

  it('offers nothing for an empty query rather than the whole book', () => {
    expect(matchCustomers(customers, '')).toEqual([]);
    expect(matchCustomers(customers, '   ')).toEqual([]);
  });

  it('matches a partial name', () => {
    expect(matchCustomers(customers, 'רונית').map((c) => c.id)).toEqual(['a', 'c']);
  });

  it('matches a phone on its digits, however it was typed on either side', () => {
    expect(matchCustomers(customers, '1112233').map((c) => c.id)).toEqual(['a']);
    expect(matchCustomers(customers, '052-111').map((c) => c.id)).toEqual(['a']);
  });

  it('will not search on a two-digit fragment — that is everybody', () => {
    expect(matchCustomers(customers, '05')).toEqual([]);
  });

  it('survives a customer with no phone on file', () => {
    expect(() => matchCustomers(customers, '999')).not.toThrow();
    expect(matchCustomers(customers, '999').map((c) => c.id)).toEqual(['b']);
  });

  it('caps the list, so the box stays a shortcut', () => {
    const many = Array.from({ length: 30 }, (_, i) => cust({ id: `x${i}`, name: `לקוח ${i}` }));
    expect(matchCustomers(many, 'לקוח')).toHaveLength(CUSTOMER_MATCH_LIMIT);
  });
});

describe('ticketCustomerKey', () => {
  /* The report is the number a garage acts on, so what it counts as one
     customer has to be what the database counts as one: the row id. */
  it('keys on the customer row, so one person typed two ways is one key', () => {
    expect(ticketCustomerKey(ticket({ customer: 'רונית לוי', customerId: 'c1', phone: '052-111-2233' })))
      .toBe(ticketCustomerKey(ticket({ customer: 'רונית', customerId: 'c1', phone: '0509999999' })));
  });

  /* The case the phone key got wrong: a couple, a company line, a parent
     paying for a student's car. Two customers, one number, two rows on the
     report — and two people to bill. */
  it('keeps two customers apart when they share a number', () => {
    expect(ticketCustomerKey(ticket({ customer: 'דנה', customerId: 'c1', phone: '0521112233' })))
      .not.toBe(ticketCustomerKey(ticket({ customer: 'עופר', customerId: 'c2', phone: '0521112233' })));
  });

  it('keeps a shared name apart when the numbers differ', () => {
    expect(ticketCustomerKey(ticket({ customer: 'משה כהן', phone: '0521112233' })))
      .not.toBe(ticketCustomerKey(ticket({ customer: 'משה כהן', phone: '0549998877' })));
  });

  /* Tickets written before create_ticket resolved a customer at all carry no
     id. They were created under the old rule, where one number was one
     customer, so grouping them by phone is what they meant at the time. */
  it('falls back to the number for a ticket with no customer row', () => {
    expect(ticketCustomerKey(ticket({ customer: 'רונית לוי', phone: '052-111-2233' })))
      .toBe(ticketCustomerKey(ticket({ customer: 'רונית', phone: '0521112233' })));
  });

  it('prefers the row over the number, so a corrected phone does not split a customer', () => {
    expect(ticketCustomerKey(ticket({ customerId: 'c1', phone: '0521112233' })))
      .toBe('id:c1');
  });

  it('falls back to the name for a ticket with no number', () => {
    expect(ticketCustomerKey(ticket({ customer: 'מזדמן', phone: undefined }))).toBe('name:מזדמן');
  });

  it('cannot collide a name key with a phone key', () => {
    expect(ticketCustomerKey(ticket({ customer: '0521112233', phone: undefined })))
      .not.toBe(ticketCustomerKey(ticket({ customer: 'מישהו', phone: '0521112233' })));
  });
});

describe('customerKind', () => {
  it('passes a code through', () => {
    expect(customerKind('private')).toBe('private');
    expect(customerKind('business')).toBe('business');
  });

  /* The migration that rewrites the column and the deploy that ships this code
     are separate events, and a row read in between still has to render. */
  it('maps the Hebrew the column held before the migration', () => {
    expect(customerKind('פרטי')).toBe('private');
    expect(customerKind('עסקי')).toBe('business');
    expect(isBusinessCustomer('עסקי')).toBe(true);
  });

  it('falls back to private rather than rendering a missing label at somebody', () => {
    expect(customerKind(null)).toBe('private');
    expect(customerKind(undefined)).toBe('private');
    expect(customerKind('')).toBe('private');
    expect(customerKind('something else')).toBe('private');
    expect(isBusinessCustomer('something else')).toBe(false);
  });
});
