import { describe, expect, it } from 'vitest';
import type { Column } from './types';
import { compareValues, sortRows } from './useTable';

interface Row {
  k: string;
  name: string;
  amount: number;
}

const rows: Row[] = [
  { k: 'GAR-10', name: 'בני ובניו', amount: 300 },
  { k: 'GAR-2', name: 'אבי מוסך', amount: 1200 },
  { k: 'GAR-1', name: 'גל רכב', amount: 300 },
];

const columns: Column<Row>[] = [
  { key: 'k', render: (r) => r.k, sortValue: (r) => r.k },
  { key: 'name', render: (r) => r.name, sortValue: (r) => r.name },
  { key: 'amount', render: (r) => r.amount, sortValue: (r) => r.amount },
  { key: 'actions', render: () => null },
];

describe('compareValues', () => {
  it('orders numbers numerically, not as text', () => {
    expect(compareValues(9, 10)).toBeLessThan(0);
  });

  it('orders embedded numbers by value — GAR-2 before GAR-10', () => {
    expect(compareValues('GAR-2', 'GAR-10')).toBeLessThan(0);
  });

  it('orders Hebrew by the Hebrew alphabet', () => {
    expect(compareValues('אבי', 'בני')).toBeLessThan(0);
    expect(compareValues('בני', 'גל')).toBeLessThan(0);
  });
});

describe('sortRows', () => {
  it('returns rows untouched when nothing is sorted', () => {
    expect(sortRows(rows, columns, null).map((r) => r.k)).toEqual(['GAR-10', 'GAR-2', 'GAR-1']);
  });

  it('sorts ascending', () => {
    expect(sortRows(rows, columns, { key: 'k', dir: 1 }).map((r) => r.k))
      .toEqual(['GAR-1', 'GAR-2', 'GAR-10']);
  });

  it('sorts descending', () => {
    expect(sortRows(rows, columns, { key: 'k', dir: -1 }).map((r) => r.k))
      .toEqual(['GAR-10', 'GAR-2', 'GAR-1']);
  });

  it('sorts on the column value, which need not be what the cell renders', () => {
    expect(sortRows(rows, columns, { key: 'amount', dir: 1 }).map((r) => r.amount))
      .toEqual([300, 300, 1200]);
  });

  it('leaves ties in their incoming order', () => {
    // Both are 300; GAR-10 came first and must stay first.
    const sorted = sortRows(rows, columns, { key: 'amount', dir: 1 });
    expect([sorted[0].k, sorted[1].k]).toEqual(['GAR-10', 'GAR-1']);
  });

  it('does not mutate the array it was given', () => {
    const before = [...rows];
    sortRows(rows, columns, { key: 'k', dir: 1 });
    expect(rows).toEqual(before);
  });

  it('ignores a sort on a column that cannot sort', () => {
    expect(sortRows(rows, columns, { key: 'actions', dir: 1 }).map((r) => r.k))
      .toEqual(['GAR-10', 'GAR-2', 'GAR-1']);
  });

  it('ignores a sort on a column that no longer exists', () => {
    expect(sortRows(rows, columns, { key: 'gone', dir: 1 }).map((r) => r.k))
      .toEqual(['GAR-10', 'GAR-2', 'GAR-1']);
  });
});
