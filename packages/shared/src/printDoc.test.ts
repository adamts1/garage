import { afterEach, describe, expect, it } from 'vitest';
import { setCurrentGarage } from './auth';
import { carHistoryHtml, carHistoryTitle, workOrderHtml, workOrderTitle } from './printDoc';
import type { Ticket } from './types';

/* The web opens this in a window; the phone hands the same string to
   expo-print, which renders it in a WebView and prints that. So what is
   asserted here is that the function returns a WHOLE document — the web used to
   assemble the wrapper itself, and a body without one prints as unstyled text
   on a phone.

   What the sheet says is covered against the web's printTicket in
   src/lib/print.test.ts, which calls straight through to this. */

afterEach(() => setCurrentGarage(null));

const ticket: Ticket = {
  k: 'GAR-12', st: 'done', type: 'job', epic: 'service', prio: 'high', pts: 3,
  who: 'dk', job: 'W-4', title: 'רעש מהבלמים',
  plate: '12-345-67', car: 'מאזדה 3', customer: 'יוסי לוי',
  amount: 590, done: 0, subtasks: [], due: '-', flags: [],
  phone: '050-1234567',
  works: [{
    uid: 'w1', code: 'BRK-01', name: 'החלפת רפידות', labor: 300,
    items: [{ sku: 'P-1', name: 'רפידות קדמיות', qty: 2, price: 100 }],
  }],
} as Ticket;

const totals = { labour: 300, items: 200, vat: 90, total: 590 };

describe('workOrderHtml', () => {
  it('is a complete document, not a fragment', () => {
    const html = workOrderHtml(ticket, totals);
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<style>');
    expect(html).toContain('</html>');
  });

  /* Hebrew, and right to left, whatever the operator's app language is set to —
     the sheet goes to a customer. */
  it('declares its direction and encoding', () => {
    const html = workOrderHtml(ticket, totals);
    expect(html).toContain('dir="rtl"');
    expect(html).toContain('charset="utf-8"');
  });

  /* The one-page fit is a script. iOS renders through WKWebView and runs it;
     Android's print WebView has JavaScript off by default, which is what
     patches/expo-print+57.0.1.patch turns on. If this script ever stops being
     emitted, that patch is dead weight and nobody would know. */
  it('carries the one-page fit script', () => {
    const html = workOrderHtml(ticket, totals);
    expect(html).toContain('beforeprint');
    expect(html).toContain('zoom:');
  });

  it('names the document after the ticket', () => {
    expect(workOrderTitle(ticket)).toBe('כרטיס עבודה GAR-12');
    expect(workOrderHtml(ticket, totals)).toContain('<title>כרטיס עבודה GAR-12</title>');
  });

  /* Same builder, same garage state, both apps. A phone printing a ticket must
     not produce a different sheet from the counter printing the same ticket. */
  it('reads the letterhead from the signed-in garage', () => {
    setCurrentGarage({
      id: 'g1', name: 'אי-תן', role: 'admin',
      letterhead: { printName: 'אי-תן שירותי רכב בע"מ', phone: '02-6522306' },
    });
    const html = workOrderHtml(ticket, totals);
    expect(html).toContain('אי-תן שירותי רכב בע&quot;מ');
    expect(html).toContain('02-6522306');
  });
});

describe('carHistoryHtml', () => {
  const car = { id: 'car-1', plate: '12-345-67', manufacturer: 'קיה', model: 'נירו', year: '2022', km: '9000', vehicle_code: '4111' };
  const owners = [{ id: 'a', name: 'דנה', phone: null }, { id: 'b', name: 'יוסי', phone: null }];
  const visit = (k: string, over: Partial<Ticket>): Ticket =>
    ({ k, st: 'paid', title: 'טיפול', plate: '12-345-67', car: 'קיה נירו', customer: '', amount: 100, works: [], ...over }) as Ticket;

  it('lists every owner\'s visits newest first, each with its customer and km, and leaves out cancelled ones', () => {
    const html = carHistoryHtml(car, owners, [
      visit('GAR-1', { customer: 'דנה', km: '1000', createdAtISO: '2026-01-01', createdAt: '1.1.2026' }),
      visit('GAR-2', { customer: 'יוסי', km: '5000', createdAtISO: '2026-06-01', createdAt: '1.6.2026' }),
      visit('GAR-3', { customer: 'דנה', st: 'cancelled', createdAtISO: '2026-07-01' }),
    ]);
    expect(html).toContain('12-345-67');
    expect(html).toContain('דנה, יוסי');
    expect(html.indexOf('GAR-2')).toBeLessThan(html.indexOf('GAR-1'));
    expect(html).toContain('5000 ק״מ');
    expect(html).not.toContain('GAR-3');
  });

  it('is titled by the plate', () => {
    expect(carHistoryTitle(car)).toContain('12-345-67');
  });
});
