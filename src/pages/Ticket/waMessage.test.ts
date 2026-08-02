import type { Ticket, TicketPhoto } from '@garage/shared';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@garage/shared', async (importActual) => ({
  ...(await importActual<typeof import('@garage/shared')>()),
  garageName: () => 'מוסך הצפון',
}));

const { WA_PHOTO_LIMIT, waMessage, waNumber } = await import('./waMessage');

const ticket = (over: Partial<Ticket> = {}): Ticket =>
  ({
    k: 'GAR-1', customer: 'דנה כהן', car: 'טויוטה קורולה', plate: '12-345-67',
    works: [{ uid: 'w1', name: 'החלפת רפידות', code: 'X', labor: 0, hours: 0, items: [] }],
    ...over,
  }) as Ticket;

const photo = (n: number): TicketPhoto =>
  ({ id: String(n), url: `https://x/${n}.jpg`, path: `p/${n}.jpg`, caption: '', createdAt: '' }) as TicketPhoto;

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

describe('waMessage', () => {
  it('names the customer, the car and every work done', () => {
    const text = waMessage(ticket(), 1180);
    expect(text).toContain('שלום דנה כהן');
    expect(text).toContain('טויוטה קורולה (12-345-67)');
    expect(text).toContain('• החלפת רפידות');
  });

  it('states the total', () => {
    expect(waMessage(ticket(), 1180)).toContain('סה״כ לתשלום: ₪1,180.00');
  });

  it('says payment is due on collection when unpaid', () => {
    expect(waMessage(ticket({ paid: false }), 100)).toContain('התשלום יתבצע בעת האיסוף');
  });

  it('thanks the customer and names the method when paid', () => {
    const text = waMessage(ticket({ paid: true, payMethod: 'מזומן' }), 100);
    expect(text).toContain('שולם במזומן - תודה!');
    expect(text).not.toContain('התשלום יתבצע');
  });

  it('signs off with the garage', () => {
    expect(waMessage(ticket(), 100)).toContain('מוסך הצפון');
  });

  it('carries no photo section when there are none', () => {
    expect(waMessage(ticket(), 100)).not.toContain('תמונות מהמוסך');
  });

  it('uses the singular for one photo', () => {
    const text = waMessage(ticket(), 100, [photo(1)]);
    expect(text).toContain('תמונה מהמוסך:');
    expect(text).toContain('https://x/1.jpg');
  });

  it('caps the links and says how many were left out', () => {
    const photos = Array.from({ length: 7 }, (_, i) => photo(i));
    const text = waMessage(ticket(), 100, photos);
    const links = text.match(/https:\/\/x\//g) ?? [];
    // Ten URLs would bury the price the customer is meant to read.
    expect(links).toHaveLength(WA_PHOTO_LIMIT);
    expect(text).toContain('(ועוד 4 תמונות בכרטיס)');
  });

  it('does not add a "and N more" line when nothing was left out', () => {
    const text = waMessage(ticket(), 100, [photo(1), photo(2)]);
    expect(text).not.toContain('ועוד');
  });

  it('survives a ticket with no works', () => {
    expect(() => waMessage(ticket({ works: [] }), 0)).not.toThrow();
  });
});
