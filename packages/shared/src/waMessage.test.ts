import { describe, expect, it, vi } from 'vitest';
import type { Ticket, TicketPhoto, TicketWork } from './index';

vi.mock('./auth', async (importActual) => ({
  ...(await importActual<typeof import('./auth')>()),
  garageName: () => 'מוסך הצפון',
}));

const { WA_PHOTO_LIMIT, waMessage, waNumber } = await import('./waMessage');

const work = (name: string, labor = 0, items: TicketWork['items'] = []): TicketWork => ({
  uid: `w-${name}`,
  code: 'X',
  name,
  labor,
  items,
});

const ticket = (over: Partial<Ticket> = {}): Ticket =>
  ({
    k: 'GAR-1',
    customer: 'דנה כהן',
    car: 'טויוטה קורולה',
    plate: '12-345-67',
    title: '',
    works: [work('החלפת רפידות')],
    ...over,
  }) as Ticket;

const photo = (n: number): TicketPhoto =>
  ({
    id: String(n),
    url: `https://x/${n}.jpg`,
    shareUrl: `https://x/functions/v1/photo/code${n}`,
    path: `p/${n}.jpg`,
    caption: '',
    createdAt: '',
  }) as TicketPhoto;

/** A build that was never told its project URL — nothing to build a short link
 *  from, so the message has to fall back to the signed one. */
const photoWithoutShareLink = (n: number): TicketPhoto =>
  ({ ...photo(n), shareUrl: '' }) as TicketPhoto;

describe('waNumber', () => {
  it('turns a local mobile number into an international one', () => {
    expect(waNumber('050-1234567')).toBe('972501234567');
  });

  it('strips punctuation and spaces', () => {
    expect(waNumber('054 987 6543')).toBe('972549876543');
  });

  it('leaves a number that already carries the country code', () => {
    expect(waNumber('972501234567')).toBe('972501234567');
  });

  it('drops only the leading zero, not zeroes inside the number', () => {
    expect(waNumber('050-1000007')).toBe('972501000007');
  });

  it('is null when there is no phone, so the caller shows a disabled button', () => {
    expect(waNumber(undefined)).toBeNull();
    expect(waNumber('')).toBeNull();
    expect(waNumber('---')).toBeNull();
  });
});

describe('waMessage — ready for pickup', () => {
  const ready = (over: Partial<Ticket> = {}, total = 1180) => ({
    ticket: ticket(over),
    closed: true,
    total,
  });

  it('names the customer, the car and every work done', () => {
    const text = waMessage(ready());
    expect(text).toContain('שלום דנה כהן');
    expect(text).toContain('טויוטה קורולה (12-345-67)');
    expect(text).toContain('• החלפת רפידות');
  });

  it('states the total', () => {
    expect(waMessage(ready())).toContain('סה״כ לתשלום: ₪1,180.00');
  });

  it('says payment is due on collection when unpaid', () => {
    expect(waMessage(ready({ paid: false }, 100))).toContain('התשלום יתבצע בעת האיסוף');
  });

  it('thanks the customer and names the method when paid', () => {
    const text = waMessage(ready({ paid: true, payMethod: 'card' }, 100));
    expect(text).toContain('שולם בכרטיס אשראי - תודה!');
    expect(text).not.toContain('התשלום יתבצע');
  });

  /* The column is a code, and the customer never sees one. A message reading
     "שולם בcard" is the failure this is here to catch. */
  it('never sends the customer the stored code', () => {
    const text = waMessage(ready({ paid: true, payMethod: 'bank_transfer' }, 100));
    expect(text).toContain('שולם בהעברה בנקאית - תודה!');
    expect(text).not.toContain('bank_transfer');
  });

  /* Rows written before 20260810000000 still hold the Hebrew the screen said. */
  it('names the method on a row written before the codes', () => {
    expect(waMessage(ready({ paid: true, payMethod: 'מזומן' }, 100)))
      .toContain('שולם במזומן - תודה!');
  });

  /* 'other' is the catch-all, and "שולם באחר" says less than saying nothing. */
  it('does not name the method when the method is the catch-all', () => {
    const text = waMessage(ready({ paid: true, payMethod: 'other' }, 100));
    expect(text).toContain('שולם - תודה!');
    expect(text).not.toContain('אחר');
  });

  /* A ticket can be marked paid without a method recorded. This used to send the
     customer the literal word "undefined". */
  it('still thanks the customer when no payment method was recorded', () => {
    const text = waMessage(ready({ paid: true, payMethod: undefined }, 100));
    expect(text).toContain('שולם - תודה!');
    expect(text).not.toContain('undefined');
  });

  it('signs off with the garage', () => {
    expect(waMessage(ready())).toContain('מוסך הצפון');
  });

  /* An empty "העבודות שבוצעו:" above nothing reads as a bug to the customer. */
  it('omits the works header when the ticket carries none', () => {
    const text = waMessage(ready({ works: [] }, 0));
    expect(text).not.toContain('העבודות שבוצעו');
    expect(text).toContain('סה״כ לתשלום: ₪0.00');
  });

  it('names the car generically when the ticket has none', () => {
    expect(waMessage(ready({ car: '', plate: '' }))).toContain('הרכב הרכב (-)');
  });
});

describe('waMessage — quote for approval', () => {
  const quote = (over: Partial<Ticket> = {}) => ({
    ticket: ticket(over),
    closed: false,
    total: 0,
  });

  it('prices each work and breaks out the VAT', () => {
    const text = waMessage(
      quote({
        works: [
          work('החלפת שמן', 200),
          work('בלמים', 300, [{ sku: 'P1', name: 'רפידות', qty: 2, price: 150 }]),
        ],
      }),
    );

    expect(text).toContain('נדרש אישורך');
    expect(text).toContain('• החלפת שמן - ₪200.00');
    expect(text).toContain('• בלמים - ₪600.00');
    expect(text).toContain('סה״כ לפני מע״מ: ₪800.00');
    expect(text).toContain('מע״מ (18%): ₪144.00');
    expect(text).toContain('סה״כ לתשלום: ₪944.00');
  });

  it('falls back to the ticket title when there are no works to price', () => {
    expect(waMessage(quote({ works: [], title: 'רעש מהגלגל הקדמי' }))).toContain(
      '• רעש מהגלגל הקדמי',
    );
  });

  it('survives a ticket with neither works nor a title', () => {
    expect(() => waMessage(quote({ works: [], title: '' }))).not.toThrow();
  });
});

describe('waMessage — itemisation', () => {
  const brakes = work('בלמים', 300, [{ sku: 'P1', name: 'רפידות', qty: 2, price: 150 }]);

  it('breaks a work into its labour and its parts', () => {
    const text = waMessage({ ticket: ticket({ works: [brakes] }), closed: false, total: 0 });
    expect(text).toContain('• בלמים - ₪600.00');
    expect(text).toContain('◦ עבודה: ₪300.00');
    expect(text).toContain('◦ רפידות ×2 (₪150.00 ליח׳) - ₪300.00');
  });

  it('drops the quantity and unit price for a single part', () => {
    const oil = work('שמן', 100, [{ sku: 'P2', name: 'מסנן שמן', qty: 1, price: 40 }]);
    const text = waMessage({ ticket: ticket({ works: [oil] }), closed: false, total: 0 });
    expect(text).toContain('◦ מסנן שמן - ₪40.00');
    expect(text).not.toContain('×1');
  });

  /* The work's own price is its labour when nothing was fitted; a line saying so
     underneath reads as a second charge for the same thing. */
  it('leaves out the labour line on a work with no parts', () => {
    const text = waMessage({
      ticket: ticket({ works: [work('אבחון', 250)] }),
      closed: false,
      total: 0,
    });
    expect(text).toContain('• אבחון - ₪250.00');
    expect(text).not.toContain('עבודה: ₪250.00');
  });

  it('itemises the pickup notice too, and its lines add up to the total it states', () => {
    const text = waMessage({ ticket: ticket({ works: [brakes] }), closed: true, total: 708 });
    expect(text).toContain('• בלמים - ₪600.00');
    expect(text).toContain('◦ רפידות ×2 (₪150.00 ליח׳) - ₪300.00');
    expect(text).toContain('סה״כ לפני מע״מ: ₪600.00');
    expect(text).toContain('מע״מ (18%): ₪108.00');
    expect(text).toContain('סה״כ לתשלום: ₪708.00');
  });

  /* Without works the total is the ticket's own amount, and there is nothing
     here that explains how it splits — so the message states it and stops. */
  it('states the total alone when a closed ticket has no works to price', () => {
    const text = waMessage({ ticket: ticket({ works: [] }), closed: true, total: 500 });
    expect(text).not.toContain('סה״כ לפני מע״מ');
    expect(text).not.toContain('מע״מ (18%)');
    expect(text).toContain('סה״כ לתשלום: ₪500.00');
  });
});

describe('waMessage — photos', () => {
  const withPhotos = (photos: TicketPhoto[]) => ({
    ticket: ticket(),
    closed: true,
    total: 100,
    photos,
  });

  it('carries no photo section when there are none', () => {
    expect(waMessage(withPhotos([]))).not.toContain('תמונות מהמוסך');
  });

  it('uses the singular for one photo, and does not number it', () => {
    const text = waMessage(withPhotos([photo(1)]));
    expect(text).toContain('תמונה מהמוסך:');
    expect(text).toContain('https://x/functions/v1/photo/code1');
    expect(text).not.toContain('תמונה 1:');
  });

  it('numbers the links when there is more than one', () => {
    const text = waMessage(withPhotos([photo(1), photo(2)]));
    expect(text).toContain('תמונה 1: https://x/functions/v1/photo/code1');
    expect(text).toContain('תמונה 2: https://x/functions/v1/photo/code2');
  });

  /* The short link is the whole point — it survives the eight hours the signed
     one does not. A regression here is invisible until a customer taps a dead
     link the next morning, which is exactly when nobody is looking. */
  it('sends the short link, not the signed one', () => {
    const text = waMessage(withPhotos([photo(1)]));
    expect(text).not.toContain('https://x/1.jpg');
  });

  it('falls back to the signed link when there is no short one', () => {
    const text = waMessage(withPhotos([photoWithoutShareLink(1)]));
    expect(text).toContain('https://x/1.jpg');
  });

  it('caps the links and says how many were left out', () => {
    const text = waMessage(withPhotos(Array.from({ length: 7 }, (_, i) => photo(i))));
    expect(text.match(/functions\/v1\/photo\//g) ?? []).toHaveLength(WA_PHOTO_LIMIT);
    expect(text).toContain(`(ועוד ${7 - WA_PHOTO_LIMIT} תמונות בכרטיס)`);
  });

  it('does not add an "and N more" line when nothing was left out', () => {
    expect(waMessage(withPhotos([photo(1), photo(2)]))).not.toContain('ועוד');
  });
});
