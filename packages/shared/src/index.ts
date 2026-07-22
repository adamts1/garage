/* @garage/shared — everything the web board and the phone app both rely on.

   This package exists because they used to keep their own copies. Two `db.ts`
   files, 649 lines with 241 differing; two `Ticket` interfaces; two
   implementations of the invoice arithmetic. Nothing kept them in sync, and
   they had already drifted — mobile never gained `createdAtISO`, so it could
   not sort or age a ticket by real timestamp.

   Anything describing a row, talking to the database, or computing money
   belongs here. UI stays in the apps. Each app builds its own Supabase client
   — mobile needs the AsyncStorage adapter, the browser does not — and passes
   it to setSupabaseClient() at startup. */

export * from './types';
export * from './catalog';
export * from './db';
export * from './auth';
export { setSupabaseClient, getClient } from './client';
