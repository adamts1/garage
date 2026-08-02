import type { Ticket } from '@garage/shared';
import { useCallback } from 'react';
import { useModalResult } from '../../../store';
import type { CloseResult } from './CloseTicketModal';

/** Opens the close-and-charge drawer. Resolves the result, or null if the
 *  drawer was dismissed without finishing. */
export function useCloseTicket() {
  const open = useModalResult<CloseResult>();

  return useCallback(
    (ticket: Ticket, total: number) =>
      open('closeTicket', {
        ticketNumber: ticket.k.split('-')[1] ?? ticket.k,
        customer: ticket.customer,
        car: ticket.car,
        plate: ticket.plate,
        total,
      }),
    [open],
  );
}
