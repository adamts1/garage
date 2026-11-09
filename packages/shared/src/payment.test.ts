import { describe, expect, it } from 'vitest';
import { DEFAULT_PAY_METHOD, PAY_METHODS, mainPayMethod, payMethod, payMethodHe, paymentsTotal } from './payment';

describe('payMethod', () => {
  it('passes a code through', () => {
    for (const code of PAY_METHODS) expect(payMethod(code)).toBe(code);
  });

  /* The whole point of the migration: rows written before it still read. */
  it('resolves the Hebrew the columns held before the migration', () => {
    expect(payMethod('מזומן')).toBe('cash');
    expect(payMethod('העברה בנקאית')).toBe('bank_transfer');
    expect(payMethod('צ׳ק')).toBe('cheque');
    expect(payMethod("צ'ק")).toBe('cheque');
  });

  /* Two dialogs, two words, one payment — which was the bug that made the
     column ungroupable. */
  it('reads both spellings of a card payment as one method', () => {
    expect(payMethod('אשראי')).toBe('card');
    expect(payMethod('כרטיס אשראי')).toBe('card');
  });

  it('has no code for an open charge, which was never a payment', () => {
    expect(payMethod('חיוב פתוח')).toBeNull();
  });

  it('has no code for nothing recorded', () => {
    expect(payMethod(null)).toBeNull();
    expect(payMethod(undefined)).toBeNull();
    expect(payMethod('   ')).toBeNull();
  });

  /* Unlike customerKind, there is no sensible default: guessing 'cash' would
     put a number in the cash column that nobody counted. */
  it('has no code for free text from an import', () => {
    expect(payMethod('שילם אצל הבן')).toBeNull();
  });

  it('opens the collect dialog on a real code', () => {
    expect(PAY_METHODS).toContain(DEFAULT_PAY_METHOD);
  });
});

describe('payMethodHe', () => {
  it('names every code in Hebrew, never as the code', () => {
    for (const code of PAY_METHODS) {
      const label = payMethodHe(code);
      expect(label).toBeTruthy();
      expect(label).not.toBe(code);
      expect(label).toMatch(/[֐-׿]/);
    }
  });

  it('gives the same Hebrew for a legacy row and its code', () => {
    expect(payMethodHe('אשראי')).toBe(payMethodHe('card'));
  });

  it('prints unrecognised free text as itself', () => {
    expect(payMethodHe('שילם אצל הבן')).toBe('שילם אצל הבן');
  });

  it('says nothing when nothing was recorded', () => {
    expect(payMethodHe(null)).toBeNull();
    expect(payMethodHe('')).toBeNull();
  });
});

describe('several payments on one document', () => {
  it('adds them up to the agora', () => {
    expect(paymentsTotal([{ method: 'cash', amount: 0.1 }, { method: 'card', amount: 0.2 }])).toBe(0.3);
    expect(paymentsTotal([])).toBe(0);
  });

  it('names the ticket by the method that brought in the most', () => {
    expect(mainPayMethod([{ method: 'cash', amount: 500 }, { method: 'card', amount: 680 }])).toBe('card');
    expect(mainPayMethod([])).toBeNull();
  });

  it('breaks a tie toward the part the customer started with', () => {
    expect(mainPayMethod([{ method: 'bit', amount: 300 }, { method: 'cash', amount: 300 }])).toBe('bit');
  });
});
