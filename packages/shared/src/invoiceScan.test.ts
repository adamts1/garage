import { describe, expect, it } from 'vitest';
import {
  applyDocumentDiscount, draftFromExtraction, isValidIsraeliTaxId, scanChecks, scanLines,
  type InvoiceExtraction,
} from './invoiceScan';

const ex = (over: Partial<InvoiceExtraction> = {}): InvoiceExtraction => ({
  supplier_name: 'חלקי רכב הצפון בע״מ', supplier_tax_id: '123456782', exempt_dealer: false,
  document_type: 'חשבונית מס', invoice_number: '10452', invoice_date: '2026-11-12',
  prices_include_vat: false,
  lines: [
    { desc: 'רפידות בלמים', qty: 2, unit_price: 185, line_total: 370 },
    { desc: 'מסנן שמן', qty: 4, unit_price: 32.5, line_total: 130 },
  ],
  document_discount: null, subtotal: 500, vat_amount: 90, total: 590, unreadable: null,
  ...over,
});
const checks = (e: InvoiceExtraction) => scanChecks(draftFromExtraction(e), { supplierChosen: false });

describe('isValidIsraeliTaxId', () => {
  it('accepts a valid check digit, in any print form', () => {
    expect(isValidIsraeliTaxId('123456782')).toBe(true);
    expect(isValidIsraeliTaxId('12-345678-2')).toBe(true);
    expect(isValidIsraeliTaxId('18')).toBe(false); // too short to be a tax id
    expect(isValidIsraeliTaxId('000000018')).toBe(true);
  });
  it('rejects one digit misread', () => {
    expect(isValidIsraeliTaxId('123456789')).toBe(false);
    expect(isValidIsraeliTaxId('123456728')).toBe(false);
  });
  it('treats blank as missing, not invalid', () => {
    expect(isValidIsraeliTaxId('')).toBeNull();
    expect(isValidIsraeliTaxId(null)).toBeNull();
  });
});

describe('an invoice with VAT', () => {
  it('reads clean and adds up', () => {
    const d = draftFromExtraction(ex());
    expect(d.vatRate).toBe(0.18);
    expect(d.vatBasis).toBe('vat_on_document');
    expect(d.lines.every((l) => l.flags.length === 0)).toBe(true);
    const c = checks(ex());
    expect(c.linesSubtotal).toBe(500);
    expect(c.mismatch).toBeNull();
    expect(c.vatMismatch).toBe(false);
    expect(c.taxIdInvalid).toBe(false);
    expect(c.missing).toEqual([]);
  });

  it('compares the lines with the pre-VAT subtotal, not the total', () => {
    expect(checks(ex()).expected).toBe(500);
  });

  it('derives the pre-VAT figure when only total and VAT were printed', () => {
    expect(checks(ex({ subtotal: null })).expected).toBe(500);
  });

  it('allows a shekel of rounding, and no more', () => {
    expect(checks(ex({ subtotal: 500.9, vat_amount: 90.16, total: 591.06 })).mismatch).toBeNull();
    expect(checks(ex({ subtotal: 600, vat_amount: 108, total: 708 })).mismatch).toBe(-100);
  });

  it('flags VAT that is not the rate', () => {
    expect(checks(ex({ vat_amount: 80, total: 580 })).vatMismatch).toBe(true);
  });

  it('flags a line whose quantity × price is not its printed total', () => {
    const d = draftFromExtraction(ex({
      lines: [{ desc: 'מגב', qty: 3, unit_price: 45, line_total: 90 }],
    }));
    expect(d.lines[0].flags).toEqual(['qty', 'unitPrice']);
  });

  it('flags what the model left blank', () => {
    const d = draftFromExtraction(ex({ lines: [{ desc: null, qty: null, unit_price: 10, line_total: null }] }));
    expect(d.lines[0].flags).toEqual(['desc', 'qty']);
    expect(scanChecks(d, { supplierChosen: true }).incomplete).toBe(true);
  });

  it('marks a misread tax id', () => {
    expect(checks(ex({ supplier_tax_id: '123456789' })).taxIdInvalid).toBe(true);
  });
});

describe('an invoice without VAT', () => {
  it('עוסק פטור: no VAT, lines against the total', () => {
    const e = ex({ exempt_dealer: true, subtotal: null, vat_amount: null, total: 500 });
    const d = draftFromExtraction(e);
    expect(d.vatRate).toBe(0);
    expect(d.vatBasis).toBe('exempt_dealer');
    const c = checks(e);
    expect(c.expected).toBe(500);
    expect(c.mismatch).toBeNull();
  });

  it('zero VAT printed', () => {
    expect(draftFromExtraction(ex({ vat_amount: 0, total: 500 })).vatRate).toBe(0);
  });

  it('total equal to subtotal', () => {
    expect(draftFromExtraction(ex({ vat_amount: null, total: 500 })).vatRate).toBe(0);
  });

  it('no totals at all: the standard rate, flagged unclear', () => {
    const d = draftFromExtraction(ex({ subtotal: null, vat_amount: null, total: null }));
    expect(d.vatRate).toBe(0.18);
    expect(d.vatBasis).toBe('unclear');
    expect(scanChecks(d, { supplierChosen: true }).expected).toBeNull();
  });
});

describe('prices printed with VAT', () => {
  it('are brought to pre-VAT and still add up to the document', () => {
    const e = ex({
      prices_include_vat: true,
      lines: [
        { desc: 'שמן', qty: 3, unit_price: 49.9, line_total: 149.7 },
        { desc: 'מסנן', qty: 1, unit_price: 38, line_total: 38 },
      ],
      subtotal: null, vat_amount: 28.63, total: 187.7,
    });
    const d = draftFromExtraction(e);
    expect(d.converted).toBe('from_incl_vat');
    const c = scanChecks(d, { supplierChosen: true });
    expect(c.expected).toBe(159.07);
    expect(c.linesSubtotal).toBe(159.07);
    expect(c.mismatch).toBeNull();
  });
});

describe('a discount on the whole document', () => {
  const e = ex({
    lines: [{ desc: 'צמיג', qty: 4, unit_price: 250, line_total: 1000 }],
    document_discount: 100, subtotal: 900, vat_amount: 162, total: 1062,
  });

  it('is reported, not applied silently', () => {
    const d = draftFromExtraction(e);
    expect(d.documentDiscount).toBe(100);
    expect(scanChecks(d, { supplierChosen: true }).mismatch).toBe(100);
  });

  it('can be spread over the items', () => {
    const d = applyDocumentDiscount(draftFromExtraction(e));
    expect(d.documentDiscount).toBeNull();
    const c = scanChecks(d, { supplierChosen: true });
    expect(c.linesSubtotal).toBe(900);
    expect(c.mismatch).toBeNull();
  });
});

describe('scanLines', () => {
  it('drops an untouched line and reports a half-filled one', () => {
    const d = draftFromExtraction(ex());
    d.lines.push({ desc: '', qty: '', unitPrice: '', flags: [] });
    expect(scanLines(d)).toMatchObject({ incomplete: false });
    expect(scanLines(d).lines).toHaveLength(2);
    d.lines.push({ desc: 'משהו', qty: '', unitPrice: '5', flags: [] });
    expect(scanLines(d).incomplete).toBe(true);
  });
});
