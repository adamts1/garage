// @vitest-environment jsdom
// jsdom because the module reaches the Supabase client on import, and that
// client wants window.localStorage — the year list itself needs no DOM.
import { describe, expect, it } from 'vitest';
import { FIRST_MODEL_YEAR, YEARS } from './useNewTicket';

/* The year list was 22 entries ending at 2005 — a window, not a range of cars.
   A garage sees 1990s vans and 1980s pickups, and an advisor who cannot pick
   the year leaves it blank, which is what makes a service history unreadable a
   year later. */

describe('the model years offered at intake', () => {
  it('reaches back to 1985', () => {
    expect(FIRST_MODEL_YEAR).toBe(1985);
    expect(YEARS[YEARS.length - 1]).toBe(1985);
  });

  it('starts at the current year and counts down without gaps', () => {
    const latest = new Date().getFullYear();
    expect(YEARS[0]).toBe(latest);
    expect(YEARS.length).toBe(latest - 1985 + 1);
    expect(YEARS.every((y, i) => y === latest - i)).toBe(true);
  });

  it('covers the years a garage actually sees', () => {
    for (const y of [1985, 1994, 2003, 2018, new Date().getFullYear()]) {
      expect(YEARS).toContain(y);
    }
  });
});
