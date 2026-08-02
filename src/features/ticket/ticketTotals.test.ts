import { VAT, type Ticket, type TicketWork } from '@garage/shared';
import { describe, expect, it } from 'vitest';
import { isClosed, isSettled, storedAmount, ticketTotals } from './ticketTotals';

/* Written before the ticket page is restructured, to pin what it does with
   money today. These are characterisation tests: where the behaviour is odd,
   the test records the oddity rather than asserting what it ought to be.
   Correcting `amount` is a decision about money — it feeds the board, the
   archive and the customer report — not something to slip into a refactor. */

const work = (labor: number, items: { qty: number; price: number }[] = []): TicketWork =>
  ({
    uid: 'w1',
    code: 'X',
    name: 'עבודה',
    labor,
    hours: 0,
    items: items.map((i, n) => ({ sku: `S${n}`, name: 'חלק', qty: i.qty, price: i.price })),
  }) as TicketWork;

const ticket = (over: Partial<Ticket>): Ticket => ({ k: 'GAR-1', st: 'todo', ...over }) as Ticket;

describe('ticketTotals', () => {
  it('is all zeroes for a ticket with no works', () => {
    expect(ticketTotals([])).toEqual({ labour: 0, items: 0, vat: 0, total: 0 });
  });

  it('sums labour across works', () => {
    expect(ticketTotals([work(380), work(240)]).labour).toBe(620);
  });

  it('sums parts by quantity times price', () => {
    expect(ticketTotals([work(0, [{ qty: 2, price: 120 }, { qty: 1, price: 48 }])]).items).toBe(288);
  });

  it('charges VAT on labour and parts together', () => {
    const { vat } = ticketTotals([work(100, [{ qty: 1, price: 100 }])]);
    expect(vat).toBeCloseTo(200 * VAT, 10);
  });

  it('totals to labour + parts + VAT', () => {
    const t = ticketTotals([work(380, [{ qty: 1, price: 240 }])]);
    expect(t.total).toBeCloseTo(t.labour + t.items + t.vat, 10);
  });

  it('does NOT round — this is the number shown on screen', () => {
    // 100 * 1.18 = 118 exactly; 33.33 does not land on an agora.
    const { total } = ticketTotals([work(33.33)]);
    expect(total).not.toBe(Math.round(total));
  });
});

describe('storedAmount', () => {
  it('rounds to whole shekels', () => {
    expect(storedAmount([work(33.33)])).toBe(Math.round(33.33 * (1 + VAT)));
    expect(Number.isInteger(storedAmount([work(33.33)]))).toBe(true);
  });

  it('agrees with the displayed total when that total is already whole', () => {
    const works = [work(1000)];
    expect(storedAmount(works)).toBe(Math.round(ticketTotals(works).total));
  });

  /* The one worth knowing about before touching this page. */
  it('can differ from the number the page displays', () => {
    const works = [work(33.33)];
    const shown = ticketTotals(works).total;
    const stored = storedAmount(works);
    expect(stored).not.toBeCloseTo(shown, 10);
    // The screen says 39.33…, the ticket records 39.
    expect(stored).toBe(39);
    expect(shown).toBeCloseTo(39.3294, 3);
  });

  it('is zero for no works', () => {
    expect(storedAmount([])).toBe(0);
  });
});

describe('isClosed', () => {
  it('is true once the work is ready for pickup', () => {
    expect(isClosed(ticket({ st: 'done' }))).toBe(true);
  });

  it('is true once paid', () => {
    expect(isClosed(ticket({ st: 'paid' }))).toBe(true);
  });

  it('is false while the work is still open', () => {
    for (const st of ['todo', 'prog', 'parts'] as const) {
      expect(isClosed(ticket({ st }))).toBe(false);
    }
  });
});

describe('isSettled', () => {
  it('is true when the ticket is in the paid column', () => {
    expect(isSettled(ticket({ st: 'paid' }))).toBe(true);
  });

  it('is true when flagged paid, whatever column it sits in', () => {
    expect(isSettled(ticket({ st: 'done', paid: true }))).toBe(true);
  });

  /* The distinction the page depends on: finished is not the same as paid, and
     only paid may close off further charging. */
  it('is false for a finished but unpaid ticket', () => {
    expect(isSettled(ticket({ st: 'done', paid: false }))).toBe(false);
    expect(isSettled(ticket({ st: 'done' }))).toBe(false);
  });
});
