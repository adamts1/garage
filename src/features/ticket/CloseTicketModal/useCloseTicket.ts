import type { Ticket } from '@garage/shared';
import { useCallback } from 'react';
import { useModalResult } from '../../../store';
import type { CloseResult } from './CloseTicketModal';

/** The ticket's own details, which both openings show and neither varies. */
const identity = (ticket: Ticket) => ({
  ticketNumber: ticket.k.split('-')[1] ?? ticket.k,
  customer: ticket.customer,
  car: ticket.car,
  plate: ticket.plate,
});

/** Opens the close-and-charge drawer. Resolves the result, or null if the
 *  drawer was dismissed without finishing.
 *
 *  `partial` lets the amount be typed down to a part payment. Only a garage
 *  with invoicing connected may be offered it: the balance left over is read
 *  off the tax invoice and its receipts, and without them nothing would
 *  remember that the customer still owes the rest. */
export function useCloseTicket() {
  const open = useModalResult<CloseResult>();

  return useCallback(
    (ticket: Ticket, total: number, partial = false) =>
      open('closeTicket', { ...identity(ticket), total, partial }),
    [open],
  );
}

/** Opens the same drawer to take money against a bill already issued: the
 *  outstanding amount rather than the ticket's total, editable down to a part
 *  payment, and no open-charge card — the bill exists, so "pay later" is the
 *  state the ticket is already in. */
export function useCollectPayment() {
  const open = useModalResult<CloseResult>();

  return useCallback(
    (ticket: Ticket, owed: number, docnum: string) =>
      open('closeTicket', { ...identity(ticket), total: owed, docnum, mode: 'collect' }),
    [open],
  );
}
