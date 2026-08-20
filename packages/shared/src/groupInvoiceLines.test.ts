/* Regrouping a frozen invoice under the works it was issued from.
 *
 * The whole value of this function is what it REFUSES to do. It is shown to a
 * customer on a copy of a tax document, so a grouping that is merely plausible
 * is worse than no grouping: it would put a part under a heading it was never
 * charged under, on paper, with a legal number at the top.
 *
 * So most of what follows is the refusals. The one success case is there to
 * prove the refusals are not simply "always null". */

import { describe, expect, it } from 'vitest';
import { groupInvoiceLines } from './invoices';
import type { Invoice, InvoiceLine } from './invoices';
import type { TicketWork } from './catalog';

const line = (desc: string, qty: number, unit: number): InvoiceLine =>
  ({ desc, qty, unit_price: unit, line_total: qty * unit });

const works: TicketWork[] = [
  {
    uid: 'w1', code: 'BRK-01', name: 'החלפת רפידות', labor: 300, items: [
      { sku: 'P-1', name: 'רפידות קדמיות', qty: 2, price: 100 },
      { sku: 'P-2', name: 'נוזל בלמים', qty: 1, price: 45 },
    ],
  },
  { uid: 'w2', code: 'ALG-01', name: 'כיוון פרונט', labor: 180, items: [] },
];

/* Exactly what issue-invoice emits for the works above: labour, then parts, in
   order, then the next work. */
const frozen: InvoiceLine[] = [
  line('החלפת רפידות', 1, 300),
  line('רפידות קדמיות', 2, 100),
  line('נוזל בלמים', 1, 45),
  line('כיוון פרונט', 1, 180),
];

const inv = (lines: InvoiceLine[]) => ({ lines }) as Pick<Invoice, 'lines'>;

describe('when the works reproduce the invoice exactly', () => {
  it('groups every frozen line under the work it came from', () => {
    const groups = groupInvoiceLines(inv(frozen), works);
    expect(groups).not.toBeNull();
    expect(groups!.map((g) => g.name)).toEqual(['החלפת רפידות', 'כיוון פרונט']);
    expect(groups![0].labour?.unit_price).toBe(300);
    expect(groups![0].parts.map((p) => p.desc)).toEqual(['רפידות קדמיות', 'נוזל בלמים']);
    expect(groups![1].parts).toEqual([]);
  });

  /* The point of grouping is presentation, not arithmetic: the lines handed
     back must be the frozen objects, not ones rebuilt from the works. */
  it("hands back the invoice's own line objects, not copies of the ticket", () => {
    const groups = groupInvoiceLines(inv(frozen), works);
    expect(groups![0].labour).toBe(frozen[0]);
    expect(groups![0].parts[0]).toBe(frozen[1]);
  });

  /* A work charged for parts but no labour is a real shape, and issue-invoice
     emits no labour line for it. */
  it('handles a work with parts and no labour', () => {
    const free: TicketWork[] = [{ uid: 'w1', code: 'X', name: 'בדיקה', labor: 0, items: [
      { sku: 'P-9', name: 'מסנן', qty: 1, price: 55 },
    ] }];
    const groups = groupInvoiceLines(inv([line('מסנן', 1, 55)]), free);
    expect(groups![0].labour).toBeNull();
    expect(groups![0].parts).toHaveLength(1);
  });

  /* A part priced at zero was never billed, so no line exists for it and its
     absence must not break the match. */
  it('skips a part that was never charged for', () => {
    const withFreebie: TicketWork[] = [{ uid: 'w1', code: 'X', name: 'טיפול', labor: 200, items: [
      { sku: 'P-0', name: 'ניגוב', qty: 1, price: 0 },
      { sku: 'P-1', name: 'שמן', qty: 4, price: 60 },
    ] }];
    const groups = groupInvoiceLines(
      inv([line('טיפול', 1, 200), line('שמן', 4, 60)]),
      withFreebie,
    );
    expect(groups![0].parts.map((p) => p.desc)).toEqual(['שמן']);
  });
});

describe('when the works no longer explain the invoice', () => {
  it('refuses when a work was renamed after billing', () => {
    const renamed = works.map((w, i) => (i === 0 ? { ...w, name: 'שם אחר' } : w));
    expect(groupInvoiceLines(inv(frozen), renamed)).toBeNull();
  });

  it('refuses when a price was changed after billing', () => {
    const repriced = works.map((w, i) => (i === 0 ? { ...w, labor: 350 } : w));
    expect(groupInvoiceLines(inv(frozen), repriced)).toBeNull();
  });

  it('refuses when a quantity was changed after billing', () => {
    const requantified = works.map((w, i) => (i === 0
      ? { ...w, items: [{ ...w.items[0], qty: 3 }, w.items[1]] }
      : w));
    expect(groupInvoiceLines(inv(frozen), requantified)).toBeNull();
  });

  /* A work added to the ticket after the invoice was issued: the frozen lines
     run out before the works do. */
  it('refuses when the ticket gained a work after billing', () => {
    const extra = [...works, { uid: 'w3', code: 'Z', name: 'חדשה', labor: 90, items: [] }];
    expect(groupInvoiceLines(inv(frozen), extra)).toBeNull();
  });

  /* And the other way round: lines the works cannot account for. */
  it('refuses when the invoice has a line the works do not explain', () => {
    expect(groupInvoiceLines(inv([...frozen, line('משהו', 1, 10)]), works)).toBeNull();
  });

  it('refuses when the works are in a different order', () => {
    expect(groupInvoiceLines(inv(frozen), [works[1], works[0]])).toBeNull();
  });

  it('returns null for a document with no lines at all — a receipt', () => {
    expect(groupInvoiceLines(inv([]), works)).toBeNull();
  });

  it('returns null when no works were handed over', () => {
    expect(groupInvoiceLines(inv(frozen), undefined)).toBeNull();
    expect(groupInvoiceLines(inv(frozen), [])).toBeNull();
  });
});

/* Numbers that went through a float and back out of Postgres do not have to be
   bit-identical to compare equal as money. */
describe('rounding', () => {
  it('matches figures that differ by less than an agora', () => {
    const w: TicketWork[] = [{ uid: 'w1', code: 'X', name: 'עבודה', labor: 100.001, items: [] }];
    expect(groupInvoiceLines(inv([line('עבודה', 1, 100)]), w)).not.toBeNull();
  });

  it('still refuses a difference of one agora', () => {
    const w: TicketWork[] = [{ uid: 'w1', code: 'X', name: 'עבודה', labor: 100.01, items: [] }];
    expect(groupInvoiceLines(inv([line('עבודה', 1, 100)]), w)).toBeNull();
  });
});
