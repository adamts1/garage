/* Who a customer is.
 *
 * The phone is the identifier. Not the name — two people share one, and one
 * person is typed three ways — and not the ת״ז, which most walk-ins never
 * give. ת״ז rides alongside it and is optional.
 *
 * This module exists because that rule has to be the same in four places that
 * used to each have their own idea: `create_ticket` resolving a ticket to a
 * customer, the two intake forms warning that a number is already taken, and
 * the customer report deciding which tickets belong to one person. When the
 * report groups by a name string and the database groups by a phone, the two
 * disagree about how many customers the garage has — and the report is the
 * number the garage acts on.
 *
 * The SQL side is the mirror of this, in create_ticket; keep them in step.
 */

import type { Ticket } from './types';

/** The minimum a row needs for these rules to apply to it. Declared here rather
 *  than importing `Customer` from db.ts, which would drag the Supabase client
 *  into a module that is pure arithmetic on strings — and would stop the phone
 *  app passing its own shape. `Customer` satisfies it structurally. */
export interface CustomerIdentity {
  id: string;
  name: string;
  phone: string | null;
}

/** Punctuation is not identity: 050-123-4567, 050 1234567 and 0501234567 are
 *  one number. Everything here compares digits. */
export const phoneDigits = (phone: string | null | undefined): string =>
  (phone ?? '').replace(/\D/g, '');

/* Nine digits is an Israeli landline (02-1234567); a mobile is ten. Below that
   it is not a number anybody can be called back on, and a "phone" of "1" would
   make an identifier out of a keystroke. */
export const PHONE_MIN_DIGITS = 9;

export const isUsablePhone = (phone: string | null | undefined): boolean =>
  phoneDigits(phone).length >= PHONE_MIN_DIGITS;

/** The customer in `customers` already holding this number, if any. */
export function customerByPhone<C extends CustomerIdentity>(
  customers: readonly C[],
  phone: string | null | undefined,
): C | undefined {
  const d = phoneDigits(phone);
  if (d.length < PHONE_MIN_DIGITS) return undefined;
  return customers.find((c) => phoneDigits(c.phone) === d);
}

/** Names differ in spacing and in the honorifics people type into a form; this
 *  is only ever used to decide whether to ASK, never to merge or to split. */
const looseName = (name: string | null | undefined) =>
  (name ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

export interface PhoneConflict<C extends CustomerIdentity = CustomerIdentity> {
  /** The record that already holds the number. */
  customer: C;
  /** True when the name on the form is not the name on that record — the case
   *  worth interrupting somebody over. */
  differentName: boolean;
}

/** The number is taken. Whether that is a returning customer or a mistake is
 *  something only the person at the counter can say, so this reports and does
 *  not decide. `null` when the number is free, too short to judge, or already
 *  belongs to the customer that was explicitly picked. */
export function phoneConflict<C extends CustomerIdentity>(
  customers: readonly C[],
  { phone, name, pickedId }: { phone: string; name: string; pickedId?: string | null },
): PhoneConflict<C> | null {
  const holder = customerByPhone(customers, phone);
  if (!holder) return null;
  // Picking that very customer is how the conflict is resolved, not a conflict.
  if (pickedId && holder.id === pickedId) return null;
  return { customer: holder, differentName: looseName(holder.name) !== looseName(name) };
}

/** How many matches the search box offers before it stops being a shortcut. */
export const CUSTOMER_MATCH_LIMIT = 6;

/** Fewer digits than this is a fragment, not a number — every customer in the
 *  garage has a 0 in their phone somewhere. */
const PHONE_SEARCH_MIN_DIGITS = 3;

/** The intake form's customer search: by name, or by phone once enough digits
 *  are typed to mean something.
 *
 *  Shared because both intake forms have one, and they had drifted into two
 *  copies of the same filter — the exact split §3.8 is about. The phone half
 *  compares digits for the same reason resolution does: a number typed with
 *  hyphens has to find the customer who was saved without them. */
export function matchCustomers<C extends CustomerIdentity>(
  customers: readonly C[],
  query: string,
): C[] {
  const q = query.trim();
  if (!q) return [];
  const qDigits = phoneDigits(q);
  return customers
    .filter(
      (c) =>
        c.name.toLowerCase().includes(q.toLowerCase()) ||
        (qDigits.length >= PHONE_SEARCH_MIN_DIGITS && phoneDigits(c.phone).includes(qDigits)),
    )
    .slice(0, CUSTOMER_MATCH_LIMIT);
}

/** The key a ticket rolls up under in the customer report.
 *
 *  The phone first, for the same reason the database resolves by it: it is what
 *  survives a name typed two ways. Tickets with no phone — walk-ins, and
 *  everything created before the phone was required — fall back to the name,
 *  which is all they have. The prefix keeps the two kinds of key from ever
 *  colliding. */
export const ticketCustomerKey = (t: Ticket): string => {
  const d = phoneDigits(t.phone);
  return d.length >= PHONE_MIN_DIGITS ? `phone:${d}` : `name:${(t.customer ?? '').trim()}`;
};
