/* What a new ticket contains before anybody edits it.

   Everything here is written into a row and read back by the other app, so it
   belongs to neither app's translation file: changing a label must not rewrite
   data, and one app must not hold a private copy of what a value means. These
   lived as literals in both intake forms — src/pages/NewTicket and the phone's
   components/tickets — with nothing connecting the copies.

   They are codes, not Hebrew words. A stored value that is also the text a
   screen displays is two things at once, and the day somebody rewords the
   screen is the day the data changes meaning. What a user reads is looked up
   from the code, per app, in that app's own locale file.
   See supabase/migrations/20260805010000_language_neutral_vocabulary.sql. */

import type { TicketWork } from './catalog';
import type { Ticket } from './types';

/* The whole flag vocabulary — every code `tickets.flags` may hold.

   Only the first three are written by anything today. The rest arrived with the
   garages' original data and nothing reads them, but they are listed because a
   column documented as "codes" while holding four undocumented Hebrew strings is
   not documented at all. */
export const TICKET_FLAGS = {
  /** The customer left a key, so the car can be moved without calling them. */
  keyReceived: 'key_received',
  /** Set at intake and never cleared — it marks a ticket nobody has worked yet. */
  new: 'new',
  /** A business customer. Read in SQL to derive `customers.kind`; see the
   *  create_ticket migrations. Not set by the intake forms today. */
  business: 'business',

  /* Legacy, from the imported data. Nothing writes or reads these. */
  blocked: 'blocked',
  readyForPickup: 'ready_for_pickup',
  awaitingApproval: 'awaiting_approval',
  vip: 'vip',
} as const;

export type TicketFlag = (typeof TICKET_FLAGS)[keyof typeof TICKET_FLAGS];

/** Shown in place of a field left empty, so the board renders a dash not a gap. */
export const EMPTY_FIELD = '-';

/** The flags a ticket is opened with. */
export const intakeFlags = (keyReceived: boolean): TicketFlag[] => [
  ...(keyReceived ? [TICKET_FLAGS.keyReceived] : []),
  TICKET_FLAGS.new,
];

/* The client's guess at the next numbers. create_ticket assigns the real ones
   server-side and the caller resyncs to pull them back; this only has to avoid
   colliding with something already on screen. */
const highest = (values: string[]) =>
  values.reduce((max, v) => Math.max(max, Number(v.split('-')[1]) || 0), 0);

export function nextTicketNumbers(existing: readonly Ticket[]): { key: string; job: string } {
  return {
    key: `GAR-${highest(existing.map((t) => t.k)) + 1}`,
    job: `W-${highest(existing.map((t) => t.job)) + 1}`,
  };
}

/* The works are what the ticket is about, so they name it.

   Empty when there are none — deliberately. A placeholder written into the
   column ("כרטיס חדש") is indistinguishable from a title somebody typed: it
   sorts, it matches a search, and it fills the card as though it meant
   something. A ticket with no works has no description, and each app says so in
   its own words at the point of display. */
export const titleFromWorks = (works: readonly TicketWork[]): string =>
  works.map((w) => w.name).join(' + ');

/** Each chosen work becomes a subtask, so the card's progress tracks real work. */
export const subtasksFromWorks = (works: readonly TicketWork[]): string[] =>
  works.map((w) => w.name);

/** "טויוטה קורולה 2019" — what the ticket stores in `car`. */
export const carLabel = (parts: {
  manufacturer?: string;
  model?: string;
  year?: string;
}): string =>
  [parts.manufacturer, parts.model, parts.year].filter(Boolean).join(' ') || EMPTY_FIELD;

/** "הרצל 4, חיפה" — street and city as one stored line. */
export const addressLabel = (parts: { address?: string; city?: string }): string =>
  [parts.address, parts.city].filter(Boolean).join(', ');
