import { describe, expect, it } from 'vitest';
import type { Ticket, TicketWork } from '@garage/shared';
import { buildNewTicket, EMPTY_FORM, isDirty, missingFields, type TicketForm } from './newTicket';

const form = (over: Partial<TicketForm> = {}): TicketForm => ({
  ...EMPTY_FORM,
  customerName: 'דנה כהן',
  customerPhone: '050-1234567',
  licensePlate: '12-345-67',
  manufacturer: 'טויוטה',
  km: '84000',
  keyReceived: true,
  ...over,
});

const work = (name: string, labor = 100): TicketWork => ({
  uid: `w-${name}`,
  code: 'X',
  name,
  labor,
  items: [],
});

describe('missingFields', () => {
  it('passes a fully filled form', () => {
    expect(missingFields(form())).toEqual([]);
  });

  it('names every field that is still blank', () => {
    expect(missingFields(EMPTY_FORM)).toEqual([
      'customerName',
      'customerPhone',
      'licensePlate',
      'manufacturer',
      'km',
      'keyReceived',
    ]);
  });

  /* Not merely "non-empty": create_ticket resolves the customer by this number,
     so a keystroke saved as a phone opens a new customer record every visit. */
  it('rejects a phone too short to call back', () => {
    expect(missingFields(form({ customerPhone: '05' }))).toEqual(['customerPhone']);
  });

  it('treats whitespace as blank', () => {
    expect(missingFields(form({ customerName: '   ' }))).toEqual(['customerName']);
  });
});

describe('isDirty', () => {
  it('is clean when nothing has been touched', () => {
    expect(isDirty(EMPTY_FORM, [], '')).toBe(false);
  });

  it('is dirty on a half-typed name, a work, or an abandoned search', () => {
    expect(isDirty({ ...EMPTY_FORM, customerName: 'ד' }, [], '')).toBe(true);
    expect(isDirty(EMPTY_FORM, [work('בלמים')], '')).toBe(true);
    expect(isDirty(EMPTY_FORM, [], 'כהן')).toBe(true);
  });
});

describe('buildNewTicket', () => {
  const existing = [
    { k: 'GAR-4', job: 'W-9' },
    { k: 'GAR-11', job: 'W-2' },
  ] as Ticket[];

  const now = new Date('2026-08-05T09:00:00Z');

  it('guesses the next key and job from the highest already in use', () => {
    const ticket = buildNewTicket({ form: form(), works: [], existing, now });
    expect(ticket.k).toBe('GAR-12');
    expect(ticket.job).toBe('W-10');
  });

  it('starts at 1 when the garage has no tickets yet', () => {
    const ticket = buildNewTicket({ form: form(), works: [], existing: [], now });
    expect(ticket.k).toBe('GAR-1');
    expect(ticket.job).toBe('W-1');
  });

  /* 'dk' — a mechanic hardcoded in an older shared/types.ts — used to be the
     default here, and in a garage with no workers the assignee foreign key
     rejected the insert outright. Unassigned is a real state. */
  it('leaves the ticket unassigned', () => {
    expect(buildNewTicket({ form: form(), works: [], existing, now }).who).toBeNull();
  });

  it('titles the ticket after its works, and lists them as subtasks', () => {
    const works = [work('החלפת שמן'), work('בלמים')];
    const ticket = buildNewTicket({ form: form(), works, existing, now });

    expect(ticket.title).toBe('החלפת שמן + בלמים');
    expect(ticket.subtasks).toEqual(['החלפת שמן', 'בלמים']);
    expect(ticket.done).toBe(0);
    expect(ticket.amount).toBe(236); // 200 net + 18% VAT
  });

  /* Codes, not the Hebrew the column used to hold — asserted as literals rather
     than through TICKET_FLAGS so that renaming the constant cannot quietly
     rewrite what lands in the database. */
  it('flags the key only when one was handed over', () => {
    expect(buildNewTicket({ form: form(), works: [], existing, now }).flags).toEqual([
      'key_received',
      'new',
    ]);
    expect(
      buildNewTicket({ form: form({ keyReceived: false }), works: [], existing, now }).flags,
    ).toEqual(['new']);
  });

  it('joins the car out of make, model and year, and the address out of street and city', () => {
    const ticket = buildNewTicket({
      form: form({ model: 'קורולה', year: '2019', address: 'הרצל 4', city: 'חיפה' }),
      works: [],
      existing,
      now,
    });

    expect(ticket.car).toBe('טויוטה קורולה 2019');
    expect(ticket.address).toBe('הרצל 4, חיפה');
  });

  it('writes a dash where the board would otherwise render a gap', () => {
    const ticket = buildNewTicket({ form: EMPTY_FORM, works: [], existing, now });
    expect(ticket.plate).toBe('-');
    expect(ticket.car).toBe('-');
    expect(ticket.due).toBe('-');
  });

  /* Not a placeholder. A stored "כרטיס חדש" is indistinguishable from a title
     somebody typed — it sorts, it matches a search, and it fills the card as
     though it meant something. Each app labels the empty case at the point of
     display instead. */
  it('leaves the title empty when no works name the ticket', () => {
    expect(buildNewTicket({ form: form(), works: [], existing, now }).title).toBe('');
  });
});
