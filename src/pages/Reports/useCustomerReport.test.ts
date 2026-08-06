import { VAT, type Ticket } from '@garage/shared';
import { describe, expect, it } from 'vitest';
import { rollUp, totalsOf } from './useCustomerReport';

const ticket = (over: Partial<Ticket>): Ticket => ({
  k: 'GAR-1', st: 'todo', type: 'job', epic: 'service', prio: 'med', pts: 3,
  who: null, job: 'W-1', title: 'x', plate: '-', car: '-', customer: 'דנה',
  amount: 0, done: 0, subtasks: [], due: '-', flags: [], works: [],
  ...over,
} as Ticket);

const filters = { status: 'all' as const, docFilter: 'all' as const, query: '' };

describe('rollUp', () => {
  it('groups tickets by customer', () => {
    const rows = rollUp(
      [ticket({ customer: 'דנה', amount: 100 }), ticket({ customer: 'יוסי', amount: 50 })],
      filters,
    );
    expect(rows.map((r) => r.name).sort()).toEqual(['דנה', 'יוסי']);
  });

  /* The report is what the garage bills against, so "one customer" here has to
     mean what it means in the database: the customer row. A couple, a company
     and a parent paying for a student's car all answer one number — grouping by
     it put two people's work on one line and one of them got the bill. */
  it('keeps two customers apart when they share a phone', () => {
    const rows = rollUp(
      [
        ticket({ customer: 'דנה', customerId: 'c1', phone: '052-111-2233', amount: 100 }),
        ticket({ customer: 'עופר', customerId: 'c2', phone: '052-111-2233', amount: 50 }),
      ],
      filters,
    );
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.gross).sort((a, b) => a - b)).toEqual([50, 100]);
  });

  it('joins one customer’s tickets even when the number on them changed', () => {
    const rows = rollUp(
      [
        ticket({ customer: 'דנה', customerId: 'c1', phone: '052-111-2233', amount: 100 }),
        ticket({ customer: 'דנה כהן', customerId: 'c1', phone: '054-999-8877', amount: 50 }),
      ],
      filters,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].gross).toBe(150);
  });

  it('sums gross per customer', () => {
    const rows = rollUp(
      [ticket({ customer: 'דנה', amount: 100 }), ticket({ customer: 'דנה', amount: 50 })],
      filters,
    );
    expect(rows[0].gross).toBe(150);
    expect(rows[0].tickets).toBe(2);
  });

  it('backs VAT out of the gross rather than adding it on', () => {
    // Ticket amounts already include VAT, so net must come out below gross.
    const [row] = rollUp([ticket({ customer: 'דנה', amount: 118 })], filters);
    expect(row.net).toBeCloseTo(118 / (1 + VAT), 6);
    expect(row.vat).toBeCloseTo(118 - 118 / (1 + VAT), 6);
    expect(row.net + row.vat).toBeCloseTo(row.gross, 6);
  });

  it('counts only closed-and-unpaid tickets as an open balance', () => {
    const [row] = rollUp(
      [
        ticket({ customer: 'דנה', amount: 100, st: 'done', paid: false }),
        ticket({ customer: 'דנה', amount: 200, st: 'done', paid: true }),
        ticket({ customer: 'דנה', amount: 400, st: 'todo', paid: false }),
      ],
      filters,
    );
    expect(row.balance).toBe(100);
  });

  it('averages over the customer’s own tickets', () => {
    const [row] = rollUp(
      [ticket({ customer: 'דנה', amount: 100 }), ticket({ customer: 'דנה', amount: 300 })],
      filters,
    );
    expect(row.avg).toBe(200);
  });

  it('filters by status', () => {
    const rows = rollUp(
      [ticket({ customer: 'דנה', st: 'done' }), ticket({ customer: 'יוסי', st: 'todo' })],
      { ...filters, status: 'done' },
    );
    expect(rows.map((r) => r.name)).toEqual(['דנה']);
  });

  it('filters by customer name, case-insensitively', () => {
    const rows = rollUp(
      [ticket({ customer: 'Dana Cohen' }), ticket({ customer: 'יוסי' })],
      { ...filters, query: 'dana' },
    );
    expect(rows.map((r) => r.name)).toEqual(['Dana Cohen']);
  });

  /* `doc` is the document number, so "has a document" is a truthiness check on
     a string — undefined means none was ever issued. */
  it('"open" means invoiced but unpaid', () => {
    const rows = rollUp(
      [
        ticket({ customer: 'א', doc: 'INV-1', paid: false }),
        ticket({ customer: 'ב', doc: 'INV-2', paid: true }),
        ticket({ customer: 'ג', doc: undefined, paid: false }),
      ],
      { ...filters, docFilter: 'open' },
    );
    expect(rows.map((r) => r.name)).toEqual(['א']);
  });

  it('"none" means no document was issued', () => {
    const rows = rollUp(
      [ticket({ customer: 'א', doc: 'INV-1' }), ticket({ customer: 'ג', doc: undefined })],
      { ...filters, docFilter: 'none' },
    );
    expect(rows.map((r) => r.name)).toEqual(['ג']);
  });

  /* The report is grouped by identity, like the database is. Grouping by the
     name string made it disagree with the customers table in both directions,
     and the report is the number the garage acts on. */
  it('keeps one customer in one row when the name was typed two ways', () => {
    const rows = rollUp(
      [
        ticket({ customer: 'רונית לוי', phone: '052-111-2233', amount: 100 }),
        ticket({ customer: 'רונית', phone: '0521112233', amount: 50 }),
      ],
      filters,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].gross).toBe(150);
    expect(rows[0].tickets).toBe(2);
  });

  it('keeps two customers apart when they share a name but not a number', () => {
    const rows = rollUp(
      [
        ticket({ customer: 'משה כהן', phone: '0521112233', amount: 100 }),
        ticket({ customer: 'משה כהן', phone: '0549998877', amount: 50 }),
      ],
      filters,
    );
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.gross).sort((a, b) => a - b)).toEqual([50, 100]);
  });

  it('names the row from the newest ticket, which is the last name confirmed', () => {
    // listTickets returns newest first.
    const rows = rollUp(
      [
        ticket({ customer: 'רונית לוי', phone: '0521112233' }),
        ticket({ customer: 'רונית', phone: '0521112233' }),
      ],
      filters,
    );
    expect(rows[0].name).toBe('רונית לוי');
    expect(rows[0].phone).toBe('0521112233');
  });

  it('still groups phoneless tickets by name — that is all they have', () => {
    const rows = rollUp(
      [ticket({ customer: 'מזדמן', amount: 100 }), ticket({ customer: 'מזדמן', amount: 40 })],
      filters,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].gross).toBe(140);
  });

  it('finds a customer by number, not only by name', () => {
    const rows = rollUp(
      [
        ticket({ customer: 'רונית לוי', phone: '052-111-2233', amount: 100 }),
        ticket({ customer: 'יוסי', phone: '0549998877', amount: 50 }),
      ],
      { ...filters, query: '1112233' },
    );
    expect(rows.map((r) => r.name)).toEqual(['רונית לוי']);
  });

  it('returns nothing for no tickets rather than throwing', () => {
    expect(rollUp([], filters)).toEqual([]);
  });
});

describe('totalsOf', () => {
  it('adds up across customers', () => {
    const rows = rollUp(
      [
        ticket({ customer: 'דנה', amount: 118 }),
        ticket({ customer: 'יוסי', amount: 236 }),
      ],
      filters,
    );
    const totals = totalsOf(rows);
    expect(totals.gross).toBe(354);
    expect(totals.customers).toBe(2);
    expect(totals.count).toBe(2);
    expect(totals.avg).toBe(177);
    expect(totals.net + totals.vat).toBeCloseTo(totals.gross, 6);
  });

  it('does not divide by zero when there is nothing to report', () => {
    const totals = totalsOf([]);
    expect(totals.avg).toBe(0);
    expect(totals.gross).toBe(0);
  });
});
