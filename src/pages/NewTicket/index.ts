export { default as NewTicketPage } from './NewTicketPage';
export type { NewTicketPageProps } from './NewTicketPage';
/* matchCustomers moved to @garage/shared — both intake forms need it, and two
   copies of one filter is exactly the drift §3.8 is about. */
export { emptyForm, toDueDate, useNewTicket, YEARS } from './useNewTicket';
export type { TicketForm } from './useNewTicket';
