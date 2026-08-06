/* Who a customer is.
 *
 * `customers.id` — the row's own id, and nothing else. Not the name, not the
 * phone, not the ת״ז. Each of the other three fails on a real garage:
 *
 *   - the name is typed three ways for one person and shared by two;
 *   - the phone belongs to a household and to a company. A wife, a husband and
 *     the fleet manager for eleven vans are separate customers who answer the
 *     same number;
 *   - the ת״ז is unique where it is given, and most walk-ins never give one.
 *
 * The phone WAS the identifier here, and `create_ticket` resolved by it: a
 * ticket typed with a number already on file was attached to whoever held it,
 * whatever name was on the form. That made a second customer on one number
 * unrepresentable — the garage could not open a ticket for the wife without it
 * landing on the husband. It is now a hint: the forms say whose number it is
 * and offer to attach the ticket to them, and going ahead without taking the
 * offer creates a second customer who shares the number, which is a real thing.
 *
 * What is still unique is the ת״ז, where it is present:
 * `customers_garage_id_number_key` is a partial unique index, so a second
 * holder is not a judgement call the way a shared phone is — it is a write the
 * database will refuse. The forms offer to attach the ticket to the holder and
 * refuse to save until somebody chooses, because the alternative is a ticket
 * carrying a number that belongs to a different person.
 *
 * This module exists because the rule has to be the same in four places that
 * used to each have their own idea: `create_ticket` resolving a ticket to a
 * customer, the two intake forms, and the customer report deciding which
 * tickets belong to one person. When the report groups by phone and the
 * database groups by row id, the two disagree about how many customers the
 * garage has — and the report is the number the garage acts on.
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

/** The number is on somebody's file. Whether that is a returning customer, a
 *  second person in the same household, or a mistyped digit is something only
 *  the person at the counter can say, so this reports and does not decide —
 *  and, unlike the ת״ז below, a shared number is allowed to stand. `null` when
 *  the number is free, too short to judge, or already belongs to the customer
 *  that was explicitly picked. */
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

/* ---------- the ת״ז: optional, and nobody's twice ----------

   Blank is a perfectly good ת״ז — most walk-ins never give one, and a garage
   cannot make somebody produce their teudat zehut to have their brakes done.
   What it may not be is two people's. `customers_garage_id_number_key`
   enforces that in the database — a unique index per garage, where the column
   is not null — so a second holder is not a judgement call the way a shared
   phone is: it is a write that will be refused.

   Which is exactly why it is worth catching in the app. Left to the database it
   surfaces as a 23505 on save, naming a constraint rather than the person who
   already holds the number — and the intake form cannot even get that far,
   because create_ticket drops a ת״ז somebody else holds rather than losing the
   whole ticket to a constraint. Caught here, the answer is a choice: attach
   this ticket to the holder, or correct the number. */

/** The minimum for the ת״ז rules. Wider than CustomerIdentity because the
 *  number itself has to be readable, and `Customer` satisfies it structurally. */
export interface CustomerWithIdNumber extends CustomerIdentity {
  id_number: string | null;
}

/** Punctuation and case are not identity here either: ' 12345678 ' and
 *  '12345678' are one number, and a blank field is not a number at all. */
export const normalizeIdNumber = (id: string | null | undefined): string =>
  (id ?? '').trim();

/** The customer already holding this ת״ז, if any. */
export function customerByIdNumber<C extends CustomerWithIdNumber>(
  customers: readonly C[],
  idNumber: string | null | undefined,
): C | undefined {
  const wanted = normalizeIdNumber(idNumber);
  if (!wanted) return undefined;
  return customers.find((c) => normalizeIdNumber(c.id_number) === wanted);
}

/** The ת״ז is taken. Same shape and the same restraint as phoneConflict: it
 *  reports, and the person at the counter decides. `null` when the number is
 *  free, blank, or already belongs to the customer being edited — putting a
 *  number back on the record that holds it is not a conflict. */
export function idNumberConflict<C extends CustomerWithIdNumber>(
  customers: readonly C[],
  { idNumber, name, ownerId }: { idNumber: string; name: string; ownerId?: string | null },
): PhoneConflict<C> | null {
  const holder = customerByIdNumber(customers, idNumber);
  if (!holder) return null;
  if (ownerId && holder.id === ownerId) return null;
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
 *  `tickets.customer_id` first — the row the ticket was actually resolved to,
 *  which is the only thing that means one customer now that a phone may be two
 *  people's. Rolling up by phone would put a household's tickets on one line
 *  and bill the wrong person for them; rolling up by name splits one customer
 *  whose name was typed twice.
 *
 *  The two fallbacks are for tickets that carry no id: the ones written before
 *  create_ticket resolved a customer at all. Those were created under the old
 *  rule, where one number WAS one customer, so grouping them by phone is what
 *  they meant at the time; the name is the last resort for a walk-in with
 *  neither. The prefixes keep the three kinds of key from ever colliding. */
export const ticketCustomerKey = (t: Ticket): string => {
  if (t.customerId) return `id:${t.customerId}`;
  const d = phoneDigits(t.phone);
  return d.length >= PHONE_MIN_DIGITS ? `phone:${d}` : `name:${(t.customer ?? '').trim()}`;
};

/* The two kinds a garage bills.

   Codes rather than the Hebrew words `customers.kind` used to hold. The column
   was the label: the Customers table rendered it straight out of the row, so
   rewording the screen meant rewriting data, and the phone app compared against
   its own copy of the same literal. Each app now translates the code.

   `customerKind` exists because the migration that rewrote the column and the
   deploy that ships this code are two separate events. It maps the legacy
   values too, so a row read before the migration lands still resolves — and
   anything unrecognised falls back to private rather than rendering a missing
   translation key at somebody. See
   supabase/migrations/20260805010000_language_neutral_vocabulary.sql. */
export const CUSTOMER_KINDS = ['private', 'business'] as const;

export type CustomerKind = (typeof CUSTOMER_KINDS)[number];

export const PRIVATE_CUSTOMER: CustomerKind = 'private';
export const BUSINESS_CUSTOMER: CustomerKind = 'business';

/** The Hebrew the column held before the migration. Read-only: nothing writes these. */
const LEGACY_KINDS: Record<string, CustomerKind> = {
  'פרטי': PRIVATE_CUSTOMER,
  'עסקי': BUSINESS_CUSTOMER,
};

/** Whatever the row says → a code this app can translate. */
export function customerKind(raw: string | null | undefined): CustomerKind {
  if (raw === PRIVATE_CUSTOMER || raw === BUSINESS_CUSTOMER) return raw;
  return LEGACY_KINDS[(raw ?? '').trim()] ?? PRIVATE_CUSTOMER;
}

export const isBusinessCustomer = (raw: string | null | undefined): boolean =>
  customerKind(raw) === BUSINESS_CUSTOMER;
