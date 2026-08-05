import { describe, expect, it } from 'vitest';
import { isValidCatalogCode, toCatalogCode } from './catalog';

/* A code is uppercase Latin — a work's `code` and a part's `sku` alike.
 *
 * It used to be free text, and worse: the two pickers that create a work or a
 * part while you type filled the code in from the NAME when it was left blank,
 * `name.slice(0, 6).toUpperCase()`. In a Hebrew garage that produced Hebrew
 * codes — "החלפת שמן" became "החלפת" — which cannot be dictated over a phone,
 * cannot be typed on a supplier's keypad, and in an RTL table sits in the
 * description's own direction, so it reads as missing rather than as wrong. */

describe('a catalog code', () => {
  it('rises to uppercase', () => {
    expect(toCatalogCode('brk-01')).toBe('BRK-01');
  });

  it('drops anything that is not a Latin letter, a digit or a separator', () => {
    expect(toCatalogCode('החלפת')).toBe('');
    expect(toCatalogCode('BRK החלפה 01')).toBe('BRK-01');
    expect(toCatalogCode('oil@filter!')).toBe('OILFILTER');
  });

  it('turns spaces into a single separator', () => {
    expect(toCatalogCode('brake   pads')).toBe('BRAKE-PADS');
    expect(toCatalogCode('  oil  ')).toBe('OIL');
  });

  it('never starts with a separator', () => {
    expect(toCatalogCode('-abc')).toBe('ABC');
    expect(toCatalogCode('שמן-10W40')).toBe('10W40');
  });

  it('leaves a code that already obeys the rule alone', () => {
    for (const code of ['BRK-01', 'OIL_5W30', 'P1', '10W40']) {
      expect(toCatalogCode(code)).toBe(code);
    }
  });

  /* What the create buttons wait for. A blank code is what the old fallback
     quietly produced from a Hebrew name, and it prints as a dash. */
  it('knows when there is nothing left to store', () => {
    expect(isValidCatalogCode('החלפת שמן')).toBe(false);
    expect(isValidCatalogCode('   ')).toBe(false);
    expect(isValidCatalogCode('שמן 10W40')).toBe(true);
  });
});
