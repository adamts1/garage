/* The WhatsApp message a garage sends its customer.

   One builder for both apps. There were two, and they had already drifted: the
   phone said "מוכן לאיסוף 🚗" where the counter said "מוכן לאיסוף", the phone
   coped with a ticket that had no works and the counter printed an empty
   "העבודות שבוצעו:" header above nothing, and a ticket marked paid with no
   method recorded sent the customer the word "undefined". A customer who gets a
   quote from the counter and a pickup notice from the phone was getting two
   voices; now there is one.

   Deliberately not routed through either app's i18n. This is composed in the
   customer's language rather than the operator's — translating the UI must not
   change what a garage sends out. If a second interface language is ever added,
   this needs its own decision about whose language wins. That is also why the
   phone's `t('ticket.whatsapp.*')` keys for the message body are gone: they made
   the outgoing message a function of the app's language setting. */

import { garageName } from './auth';
import { VAT, workTotal, worksSummary, type TicketWork } from './catalog';
import type { TicketPhoto } from './db';
import { money } from './money';
import { OTHER_PAY_METHOD, payMethod, payMethodHe } from './payment';
import type { Ticket } from './types';

/** 050-1234567 → 972501234567. wa.me wants digits only, with a country code. */
export const waNumber = (phone?: string | null): string | null => {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('972')) return digits;
  return '972' + digits.replace(/^0/, '');
};

/* wa.me carries text only — there is no attachment parameter — so photos travel
   as links.

   Which link matters. `photo.url` is the signed URL the app renders from: about
   330 characters, four wrapped lines in a chat window, and dead eight hours
   later — so a customer reading the message the next morning taps a broken
   link. `photo.shareUrl` is the short public one, roughly sixty characters on a
   single line, and it keeps working because the endpoint behind it signs a fresh
   URL per visit. The signed URL stays only as the fallback for a build that was
   never told its project URL; long beats nothing.

   Numbered, because a bare URL says nothing about what is behind it and two
   bare URLs say nothing about which is which.

   The cap matches the two-photo limit on a ticket. It is not redundant: tickets
   photographed before that limit existed can still carry more, and the message
   is where that would show. */
export const WA_PHOTO_LIMIT = 2;

const photoLines = (photos: readonly TicketPhoto[]): string[] => {
  if (!photos.length) return [];
  const shown = photos.slice(0, WA_PHOTO_LIMIT);
  const rest = photos.length - shown.length;
  return [
    '',
    photos.length > 1 ? 'תמונות מהמוסך:' : 'תמונה מהמוסך:',
    ...shown.map((p, i) =>
      // A single photo needs no number - "תמונה 1" out of one is noise.
      shown.length > 1 ? `תמונה ${i + 1}: ${p.shareUrl || p.url}` : (p.shareUrl || p.url),
    ),
    ...(rest > 0 ? [`(ועוד ${rest} תמונות בכרטיס)`] : []),
  ];
};

/** Only what the message says; anything else on a ticket is the sender's business. */
export type WaTicket = Pick<Ticket, 'customer' | 'car' | 'plate' | 'title' | 'paid'> &
  Partial<Pick<Ticket, 'payMethod' | 'works'>>;

export interface WaMessageInput {
  ticket: WaTicket;
  /** The car is finished: a pickup notice rather than a quote asking for approval.
   *  The caller decides — the web only offers the button on a closed ticket, the
   *  phone offers both and switches on the status. */
  closed: boolean;
  /** What to charge. A ticket with works is their total; without, its own amount. */
  total: number;
  photos?: readonly TicketPhoto[];
}

export function waMessage({ ticket, closed, total, photos = [] }: WaMessageInput): string {
  const works: TicketWork[] = ticket.works ?? [];
  const car = `${ticket.car || 'הרכב'} (${ticket.plate || '-'})`;
  const greeting = `שלום ${ticket.customer},`;

  if (closed) {
    return [
      greeting,
      `הרכב ${car} מוכן לאיסוף 🚗`,
      '',
      // Only when there is something to list — an empty header reads as a bug.
      ...(works.length ? ['העבודות שבוצעו:', ...works.map((w) => `• ${w.name}`), ''] : []),
      `סה״כ לתשלום: ${money(total)}`,
      ticket.paid ? paidLine(ticket.payMethod) : 'התשלום יתבצע בעת האיסוף.',
      ...photoLines(photos),
      '',
      `${garageName()} · נשמח לראותך`,
    ].join('\n');
  }

  const sum = worksSummary(works);
  return [
    greeting,
    `לרכב ${car} נדרש אישורך לביצוע העבודות הבאות:`,
    '',
    ...(works.length
      ? works.map((w) => `• ${w.name} - ${money(workTotal(w))}`)
      : [`• ${ticket.title || 'טיפול'}`]),
    '',
    `סה״כ לפני מע״מ: ${money(sum.net)}`,
    `מע״מ (${Math.round(VAT * 100)}%): ${money(sum.vat)}`,
    `סה״כ לתשלום: ${money(sum.total)}`,
    ...photoLines(photos),
    '',
    'נא אשרו לביצוע. תודה,',
    garageName(),
  ].join('\n');
}

/** A method is recorded most of the time but not always; saying "שולם ב" and
    then nothing is worse than not saying how — and so is "שולם באחר", which is
    what naming the catch-all code would produce. The column holds a code, so
    the Hebrew comes from the shared vocabulary rather than from the row. */
const paidLine = (method?: string | null): string => {
  const label = payMethod(method) === OTHER_PAY_METHOD ? null : payMethodHe(method);
  return label ? `שולם ב${label} - תודה!` : 'שולם - תודה!';
};
