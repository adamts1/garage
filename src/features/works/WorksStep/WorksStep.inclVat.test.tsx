// @vitest-environment jsdom

/* Taking VAT out of a part's price. The customer was quoted ₪500 all in; the
 * button turns the line into the pre-VAT price that comes back to ₪500 once
 * VAT is added at the end — on the press, so the totals move with it. */

import type { TicketWork } from '@garage/shared';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WorksStep from './WorksStep';

vi.mock('../usePickers', () => ({
  usePickWork: () => vi.fn(),
  usePickPart: () => vi.fn(),
}));
vi.mock('../../../store/usePrompt', () => ({ usePrompt: () => vi.fn() }));

afterEach(cleanup);

const work: TicketWork = {
  uid: 'w1', code: 'BR1', name: 'החלפת רפידות', labor: 100,
  items: [{ sku: 'PAD-1', name: 'רפידות קדמיות', qty: 1, price: 500 }],
};

/* Holds the works like the ticket page does, so a press re-renders with what
   it wrote — the button's second state depends on that. */
function Harness({ initial, onWorks }: { initial: TicketWork[]; onWorks: (w: TicketWork[]) => void }) {
  const [works, setWorks] = useState(initial);
  return <WorksStep works={works} setWorks={(next) => { onWorks(next); setWorks(next); }} />;
}

// i18next is not initialised here, so labels are keys.
const price = () => (screen.getByLabelText('works.fields.unitPrice') as HTMLInputElement).value;

describe('removing VAT from a part price', () => {
  it('stores the pre-VAT price the moment it is pressed', () => {
    const onWorks = vi.fn();
    render(<Harness initial={[work]} onWorks={onWorks} />);

    fireEvent.click(screen.getByRole('button', { name: 'works.removeVat' }));

    expect(onWorks).toHaveBeenCalledTimes(1);
    expect((onWorks.mock.lastCall![0] as TicketWork[])[0].items[0].price).toBe(423.73);
    expect(price()).toBe('423.73');
  });

  it('pressed again, puts the typed price back instead of taking VAT out twice', () => {
    const onWorks = vi.fn();
    render(<Harness initial={[work]} onWorks={onWorks} />);

    fireEvent.click(screen.getByRole('button', { name: 'works.removeVat' }));
    fireEvent.click(screen.getByRole('button', { name: 'works.restoreVat' }));

    expect(price()).toBe('500');
    expect(screen.getByRole('button', { name: 'works.removeVat' })).toBeTruthy();
  });

  it('typing a new price ends the undo', () => {
    render(<Harness initial={[work]} onWorks={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'works.removeVat' }));
    fireEvent.change(screen.getByLabelText('works.fields.unitPrice'), { target: { value: '300' } });

    expect(screen.getByRole('button', { name: 'works.removeVat' })).toBeTruthy();
  });
});
