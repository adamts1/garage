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
    path: `p/${n}.jpg`,
    caption: '',
    createdAt: '',
  }) as TicketPhoto;

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
    const text = waMessage(ready({ paid: true, payMethod: 'מזומן' }, 100));
    expect(text).toContain('שולם במזומן - תודה!');
    expect(text).not.toContain('התשלום יתבצע');
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

  it('uses the singular for one photo', () => {
    const text = waMessage(withPhotos([photo(1)]));
    expect(text).toContain('תמונה מהמוסך:');
    expect(text).toContain('https://x/1.jpg');
  });

  it('caps the links and says how many were left out', () => {
    const text = waMessage(withPhotos(Array.from({ length: 7 }, (_, i) => photo(i))));
    expect(text.match(/https:\/\/x\//g) ?? []).toHaveLength(WA_PHOTO_LIMIT);
    expect(text).toContain('(ועוד 4 תמונות בכרטיס)');
  });

  it('does not add an "and N more" line when nothing was left out', () => {
    expect(waMessage(withPhotos([photo(1), photo(2)]))).not.toContain('ועוד');
  });
});
