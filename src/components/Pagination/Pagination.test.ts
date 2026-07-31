import { describe, expect, it } from 'vitest';
import { GAP, pageWindow } from './Pagination';

describe('pageWindow', () => {
  it('shows every page when they all fit', () => {
    expect(pageWindow(5, 1)).toEqual([1, 2, 3, 4, 5]);
  });

  it('handles a single page', () => {
    expect(pageWindow(1, 1)).toEqual([1]);
  });

  it('treats zero pages as one — an empty table still has a page 1', () => {
    expect(pageWindow(0, 1)).toEqual([1]);
  });

  it('collapses the middle when there are many pages', () => {
    expect(pageWindow(40, 20)).toEqual([1, GAP, 19, 20, 21, GAP, 40]);
  });

  it('keeps the first pages contiguous near the start', () => {
    expect(pageWindow(40, 2)).toEqual([1, 2, 3, GAP, 40]);
  });

  it('keeps the last pages contiguous near the end', () => {
    expect(pageWindow(40, 39)).toEqual([1, GAP, 38, 39, 40]);
  });

  it('writes out a gap of exactly one page instead of an ellipsis', () => {
    // 1 … 3 is wider than 1 2 3 and says less.
    expect(pageWindow(40, 3)).toEqual([1, 2, 3, 4, GAP, 40]);
  });

  it('always includes the current page', () => {
    for (const current of [1, 7, 23, 40]) {
      expect(pageWindow(40, current)).toContain(current);
    }
  });

  it('never repeats a page', () => {
    const window = pageWindow(40, 20).filter((p): p is number => p !== GAP);
    expect(new Set(window).size).toBe(window.length);
  });

  it('stays in ascending order', () => {
    const window = pageWindow(40, 20).filter((p): p is number => p !== GAP);
    expect([...window].sort((a, b) => a - b)).toEqual(window);
  });
});
