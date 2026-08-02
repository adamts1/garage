import { garageName, type Ticket, type TicketPhoto } from '@garage/shared';

const shekel = (n: number) =>
  '₪' + n.toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 050-1234567 → 972501234567. wa.me wants digits only, with a country code. */
export const waNumber = (phone?: string): string | null => {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('972')) return digits;
  return '972' + digits.replace(/^0/, '');
};

/* wa.me carries text only — there is no attachment parameter — so photos travel
   as links. Capped, because ten URLs would bury the price the customer is meant
   to be reading. */
export const WA_PHOTO_LIMIT = 3;

const photoLines = (photos: readonly TicketPhoto[]) => {
  if (!photos.length) return [];
  const shown = photos.slice(0, WA_PHOTO_LIMIT);
  const rest = photos.length - shown.length;
  return [
    '',
    photos.length > 1 ? 'תמונות מהמוסך:' : 'תמונה מהמוסך:',
    ...shown.map((p) => p.url),
    ...(rest > 0 ? [`(ועוד ${rest} תמונות בכרטיס)`] : []),
  ];
};

/* Deliberately not routed through i18n. This is a message sent to a customer,
   composed in the customer's language rather than the operator's — translating
   the UI must not change what a garage sends out. If a second language is ever
   added, this needs its own decision about whose language wins. */
export const waMessage = (
  ticket: Ticket,
  total: number,
  photos: readonly TicketPhoto[] = [],
): string =>
  [
    `שלום ${ticket.customer},`,
    `הרכב ${ticket.car} (${ticket.plate}) מוכן לאיסוף`,
    '',
    'העבודות שבוצעו:',
    ...(ticket.works ?? []).map((w) => `• ${w.name}`),
    '',
    `סה״כ לתשלום: ${shekel(total)}`,
    ticket.paid ? `שולם ב${ticket.payMethod} - תודה!` : 'התשלום יתבצע בעת האיסוף.',
    ...photoLines(photos),
    '',
    `${garageName()} · נשמח לראותך`,
  ]
    .filter((line) => line !== undefined)
    .join('\n');
