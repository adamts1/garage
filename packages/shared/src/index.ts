/* @garage/shared — everything the web board and the phone app both rely on.

   This package exists because they used to keep their own copies. Two `db.ts`
   files, 649 lines with 241 differing; two `Ticket` interfaces; two
   implementations of the invoice arithmetic. Nothing kept them in sync, and
   they had already drifted — mobile never gained `createdAtISO`, so it could
   not sort or age a ticket by real timestamp.

   Anything describing a row, talking to the database, computing money, or
   deciding what a stored value says belongs here. UI stays in the apps. Each app
   builds its own Supabase client — mobile needs the AsyncStorage adapter, the
   browser does not — and passes it to setSupabaseClient() at startup.

   The last of those four is the subtle one. `intake.ts`, `payment.ts` and
   `waMessage.ts` hold Hebrew strings, which looks like copy and is not: the
   first is written into rows and read back by the other app, the last is sent to
   a customer, and `payment.ts` holds both — a vocabulary of codes for the
   columns, and the Hebrew a *customer* reads on a printed document. None may
   live in an app's translation file, where editing a label would change stored
   data or change what a garage sends out. Text the *operator* reads stays in
   each app's own locale file. */

export * from './types';
export * from './identity';
export * from './vehicleCatalog';
export * from './catalog';
export * from './money';
export * from './intake';
export * from './payment';
export * from './db';
export * from './auth';
export * from './waMessage';
export * from './invoices';
export * from './expenses';
export { setSupabaseClient, getClient } from './client';
