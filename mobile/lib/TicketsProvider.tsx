/* One tickets store for the whole app.

   Both screens need the same list and the same save function. Calling useTickets()
   in each of them would open two realtime subscriptions and two copies of the data,
   which drift apart the moment one of them writes. So it lives here, once. */

import React, { createContext, useContext } from 'react';
import { useTickets } from './useTickets';

type TicketsStore = ReturnType<typeof useTickets>;

const TicketsContext = createContext<TicketsStore | null>(null);

export const TicketsProvider = ({ children }: { children: React.ReactNode }) => {
  const store = useTickets();
  return <TicketsContext.Provider value={store}>{children}</TicketsContext.Provider>;
};

export const useTicketsStore = (): TicketsStore => {
  const store = useContext(TicketsContext);
  if (!store) throw new Error('useTicketsStore must be used inside <TicketsProvider>');
  return store;
};
