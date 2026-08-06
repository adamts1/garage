/* What a credit note can actually be issued for.
 *
 * The rule under test is not arithmetic for its own sake: a line is priced
 * before VAT and the provider adds the VAT, so the gross the customer sees is
 * whatever `subtotal + round(subtotal × rate)` lands on. Some grosses are simply
 * not reachable, and the one guarantee that matters is that what we store is
 * what the document says — never a figure we chose and the provider did not.
 */

import { describe, expect, it } from 'vitest';
import { issuableCredit } from './invoices';

const VAT = 0.18;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** What the provider will make of a pre-VAT figure — the calculation this whole
 *  module exists to stay on the right side of. */
const grossAtProvider = (subtotal: number) => round2(subtotal + round2(subtotal * VAT));

describe('issuableCredit', () => {
  it('agrees with what the provider will compute', () => {
    for (let agorot = 1; agorot <= 200_00; agorot += 7) {
      const asked = agorot / 100;
      const got = issuableCredit(asked, VAT, 10_000);
      expect(got).not.toBeNull();
      expect(got!.total).toBe(grossAtProvider(got!.subtotal));
      expect(round2(got!.subtotal + got!.vat)).toBe(got!.total);
    }
  });

  it('lands exactly on an amount the old arithmetic missed by an agora', () => {
    // ₪100.00 divides to ₪84.75, which grosses to ₪100.01. Nothing reaches
    // ₪100.00, so the nearest below is the answer — not a stored ₪100.00 beside
    // a document for ₪100.01.
    expect(issuableCredit(100, VAT, 1000)).toEqual({ subtotal: 84.74, vat: 15.25, total: 99.99 });
  });

  it('takes the reachable amount when there is one', () => {
    const got = issuableCredit(99.99, VAT, 1000)!;
    expect(got.total).toBe(99.99);
  });

  it('rounds down rather than up when the two are equally close', () => {
    // ₪250.00 sits between ₪249.99 and ₪250.01. An agora short is a rounding
    // artefact; an agora over is money the garage did not agree to give back.
    expect(issuableCredit(250, VAT, 1000)!.total).toBe(249.99);
  });

  it('never exceeds what is left on the invoice', () => {
    for (let agorot = 1; agorot <= 5_000; agorot += 13) {
      const cap = agorot / 100;
      const got = issuableCredit(cap, VAT, cap);
      if (got) expect(got.total).toBeLessThanOrEqual(cap);
    }
  });

  it('credits the whole of a cap that is itself issuable', () => {
    // The common last credit: everything still outstanding, and that figure came
    // off a document, so it is reachable by construction.
    const remaining = grossAtProvider(423.73);
    expect(issuableCredit(remaining, VAT, remaining)!.total).toBe(remaining);
  });

  it('refuses when nothing at or below the cap is worth issuing', () => {
    expect(issuableCredit(5, VAT, 0)).toBeNull();
  });

  it('handles a rate of zero without inventing VAT', () => {
    expect(issuableCredit(120, 0, 1000)).toEqual({ subtotal: 120, vat: 0, total: 120 });
  });
});
