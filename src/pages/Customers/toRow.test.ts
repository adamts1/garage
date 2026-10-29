import { describe, expect, it } from 'vitest';
import { blankCustomer, toRow } from './useCustomers';

/* A customer saved without a ת״ז must reach the database as NULL. A stored ''
   is a value under the per-garage unique index, so the second such customer
   was refused as a duplicate of the first. */
describe('toRow', () => {
  it('sends a blank ת״ז as null', () => {
    expect(toRow({ ...blankCustomer, name: 'טליה' }).id_number).toBeNull();
    expect(toRow({ ...blankCustomer, id_number: '   ' }).id_number).toBeNull();
  });

  it('keeps a real one, trimmed', () => {
    expect(toRow({ ...blankCustomer, id_number: ' 123456782 ' }).id_number).toBe('123456782');
  });
});
