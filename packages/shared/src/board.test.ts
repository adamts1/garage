import { describe, expect, it } from 'vitest';
import { COLUMNS, type Status } from './types';
import { modelsFor, VEHICLE_CATALOG, VEHICLE_MAKES } from './vehicleCatalog';

/* The board and the database have to agree on the set of statuses. A status the
   board cannot render is a ticket that disappears with no column to sit in —
   which is exactly what `diag` and `qa` did while the check constraint still
   allowed them. The constraint is asserted from the other side in
   supabase/tests/tenancy.mjs; this is the client half. */
describe('the board columns', () => {
  it('is the four a garage tracks, in order', () => {
    expect(COLUMNS.map((c) => c.id)).toEqual(['todo', 'appr', 'done', 'paid']);
    expect(COLUMNS.map((c) => c.title)).toEqual(['כניסה', 'ממתין לאישור', 'מוכן', 'שולם']);
  });

  it('covers every Status, so no ticket can be off the board', () => {
    const all: Status[] = ['todo', 'appr', 'done', 'paid'];
    for (const st of all) {
      expect(COLUMNS.find((c) => c.id === st)).toBeDefined();
    }
  });

  it('gives every column its own dot colour', () => {
    expect(new Set(COLUMNS.map((c) => c.dot)).size).toBe(COLUMNS.length);
  });
});

/* An aid, not a gate — both car fields stay free text. These guard the shape of
   the list and the lookup, not its contents, which are meant to be edited. */
describe('the vehicle catalog', () => {
  it('offers the models of the make that was typed', () => {
    expect(modelsFor('טויוטה')).toContain('קורולה');
    expect(modelsFor('סקודה')).toContain('אוקטביה');
  });

  it('ignores surrounding spaces and case, since the field is free text', () => {
    expect(modelsFor('  טויוטה  ')).toContain('קורולה');
    expect(modelsFor('mg')).toEqual(VEHICLE_CATALOG['MG']);
  });

  it('returns nothing for a make it has never heard of, rather than throwing', () => {
    expect(modelsFor('יצרן שלא קיים')).toEqual([]);
    expect(modelsFor('')).toEqual([]);
    expect(modelsFor(null)).toEqual([]);
    expect(modelsFor(undefined)).toEqual([]);
  });

  it('lists every make in the catalog, with models behind each', () => {
    expect(VEHICLE_MAKES.length).toBe(Object.keys(VEHICLE_CATALOG).length);
    for (const make of VEHICLE_MAKES) {
      expect(VEHICLE_CATALOG[make].length).toBeGreaterThan(0);
    }
  });

  it('has no duplicate models inside one make', () => {
    for (const make of VEHICLE_MAKES) {
      const models = VEHICLE_CATALOG[make];
      expect(new Set(models).size).toBe(models.length);
    }
  });
});
