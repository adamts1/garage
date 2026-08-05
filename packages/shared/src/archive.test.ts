import { describe, expect, it } from 'vitest';
import { isArchived, type Ticket } from './types';

/* When a paid ticket leaves the board.
 *
 * It used to be counted from the due date: two days after it, if paid. A garage
 * that took the money a week after the promised date therefore watched the
 * ticket disappear from שולם the moment it was marked paid — the column that
 * shows what came in today was empty on exactly the ticket it was about.
 *
 * The rule now: it stays for the rest of the day it was paid, and is gone the
 * next morning. The clock runs from the payment, and it turns at midnight
 * rather than 24 hours later, because "tomorrow" in a garage is the next
 * working morning — 08:00 and 19:00 on the same day must age out together. */

const at = (iso: string) => new Date(iso);

const ticket = (over: Partial<Ticket> = {}): Ticket =>
  ({
    k: 'GAR-1', st: 'paid', type: 'job', epic: 'service', prio: 'med', pts: 3, who: null,
    job: 'W-1', title: 'טיפול', plate: '11-111-11', car: 'טויוטה', customer: 'דנה',
    amount: 0, done: 0, subtasks: [], due: '-', flags: [],
    ...over,
  }) as Ticket;

describe('a paid ticket on the board', () => {
  it('stays for the rest of the day it was paid', () => {
    const t = ticket({ paidAt: '2026-08-05T09:00:00' });

    expect(isArchived(t, at('2026-08-05T09:00:01'))).toBe(false);
    expect(isArchived(t, at('2026-08-05T23:59:00'))).toBe(false);
  });

  it('is in the archive the next morning', () => {
    const t = ticket({ paidAt: '2026-08-05T09:00:00' });

    expect(isArchived(t, at('2026-08-06T00:00:00'))).toBe(true);
    expect(isArchived(t, at('2026-08-06T07:30:00'))).toBe(true);
  });

  it('ages out overnight whether it was paid at opening or at closing time', () => {
    const morning = ticket({ paidAt: '2026-08-05T08:00:00' });
    const evening = ticket({ paidAt: '2026-08-05T19:00:00' });
    const nextMorning = at('2026-08-06T08:00:00');

    // Not a rolling 24 hours: the evening one must not linger a day longer.
    expect(isArchived(morning, nextMorning)).toBe(true);
    expect(isArchived(evening, nextMorning)).toBe(true);
  });

  /* The bug, from the direction it was reported. */
  it('does not vanish the moment a long-overdue ticket is paid', () => {
    const t = ticket({
      due: '01/07/2026',                       // promised over a month ago
      createdAtISO: '2026-06-20T10:00:00Z',    // opened even earlier
      paidAt: '2026-08-05T14:00:00',           // paid just now
    });

    expect(isArchived(t, at('2026-08-05T14:00:05'))).toBe(false);
  });

  it('comes straight back when it is dragged out of שולם', () => {
    const t = ticket({ st: 'done', paidAt: null });

    expect(isArchived(t, at('2026-09-01T10:00:00'))).toBe(false);
  });

  /* A row written before the migration landed. Keeping it visible is the safe
     half of the guess: a ticket somebody can see is one they can act on. */
  it('stays on the board when nothing says when it was paid', () => {
    const t = ticket({ paidAt: null, due: '01/01/2026' });

    expect(isArchived(t, at('2026-08-05T10:00:00'))).toBe(false);
  });
});
