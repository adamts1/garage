// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import Table from './Table';
import type { Column } from './types';

/* i18next is not initialised in this file, and t() falls through to the key —
   which is fine here: nothing asserted below is a translated string. */

interface Row { id: string; name: string }

const rows: Row[] = [{ id: 'a', name: 'דנה' }, { id: 'b', name: 'יוסי' }];
const columns: Column<Row>[] = [
  { key: 'name', render: (r) => r.name },
  { key: 'note', render: () => '—' },
];

afterEach(cleanup);

/* The detail panel a row can open — a customer's cars, on the customers page. */
describe('Table renderExpanded', () => {
  it('renders nothing extra when the caller returns null', () => {
    render(<Table columns={columns} rows={rows} rowKey={(r) => r.id} renderExpanded={() => null} />);
    expect(screen.getAllByRole('row')).toHaveLength(3);   // header + two rows
  });

  it('adds one full-width row under the row it belongs to', () => {
    render(
      <Table
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        renderExpanded={(r) => (r.id === 'a' ? <p>הרכבים של דנה</p> : null)}
      />,
    );
    expect(screen.getByText('הרכבים של דנה')).toBeDefined();
    expect(screen.getAllByRole('row')).toHaveLength(4);
    // Spanning every column is what makes it a panel rather than a cell.
    const cell = screen.getByText('הרכבים של דנה').closest('td');
    expect(cell?.getAttribute('colspan')).toBe(String(columns.length));
  });

  it('opens under the right row, not the first one', () => {
    render(
      <Table
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        renderExpanded={(r) => (r.id === 'b' ? <p>panel</p> : null)}
      />,
    );
    const bodyRows = screen.getAllByRole('row').slice(1);
    expect(bodyRows[1].textContent).toContain('יוסי');
    expect(bodyRows[2].textContent).toContain('panel');
  });

  it('is optional — a table without it is unchanged', () => {
    render(<Table columns={columns} rows={rows} rowKey={(r) => r.id} />);
    expect(screen.getAllByRole('row')).toHaveLength(3);
  });
});
