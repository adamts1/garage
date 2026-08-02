import { VAT, partsTotal, type Ticket, type TicketWork } from '@garage/shared';

export interface TicketTotals {
  /** Labour only, before VAT. */
  labour: number;
  /** Every work's parts, before VAT. */
  items: number;
  vat: number;
  /** labour + items + vat, unrounded. */
  total: number;
}

/** What the summary panel, the printed ticket and the issue dialog all show. */
export function ticketTotals(works: readonly TicketWork[]): TicketTotals {
  const labour = works.reduce((s, w) => s + w.labor, 0);
  const items = works.reduce((s, w) => s + partsTotal(w), 0);
  const vat = (labour + items) * VAT;
  return { labour, items, vat, total: labour + items + vat };
}

/**
 * The figure stored on the ticket when its works change.
 *
 * NOT the same number as `ticketTotals().total`: this one is rounded to whole
 * shekels and that one is not, so a ticket can display ₪1,180.44 and store
 * ₪1,180. Both behaviours are long-standing and are pinned by tests rather
 * than corrected here — `amount` feeds the board, the archive and the customer
 * report, and changing it is a decision about money, not a tidy-up.
 */
export function storedAmount(works: readonly TicketWork[]): number {
  const { labour, items } = ticketTotals(works);
  return Math.round((labour + items) * (1 + VAT));
}

/** Work is finished — enough to notify the customer. */
export const isClosed = (ticket: Ticket): boolean =>
  ticket.st === 'done' || ticket.st === 'paid';

/**
 * Actually settled. Only a paid ticket blocks further charging; one sitting in
 * "מוכן לאיסוף" is finished but still owes money, so payment stays open.
 */
export const isSettled = (ticket: Ticket): boolean =>
  ticket.paid === true || ticket.st === 'paid';
