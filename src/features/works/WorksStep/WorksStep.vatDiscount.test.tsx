// @vitest-environment jsdom

/* הנחת מע״מ on a part: the button flags the line and leaves its price alone —
 * the totals do the rest. Pressed again, the flag is stored as nothing. */

import type { TicketWork } from '@garage/shared';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WorksStep from './WorksStep';

vi.mock('../usePickers', () => ({
  usePickWork: () => vi.fn(),
  usePickPart: () => vi.fn(),
}));
vi.mock('../../../store/usePrompt', () => ({ usePrompt: () => vi.fn() }));

afterEach(cleanup);

const work = (vatDiscount?: boolean): TicketWork => ({
  uid: 'w1', code: 'BR1', name: 'החלפת רפידות', labor: 100,
  items: [{ sku: 'PAD-1', name: 'רפידות קדמיות', qty: 1, price: 500, ...(vatDiscount && { vatDiscount }) }],
});

// i18next is not initialised here, so labels are keys.
const toggle = () => screen.getByRole('button', { name: 'works.fields.partVatDiscount' });

describe('the VAT discount on a part', () => {
  it('flags the line and keeps its price', () => {
    const setWorks = vi.fn();
    render(<WorksStep works={[work()]} setWorks={setWorks} />);
    expect(toggle().getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(toggle());

    const [next] = setWorks.mock.lastCall![0] as TicketWork[];
    expect(next.items[0]).toEqual({ sku: 'PAD-1', name: 'רפידות קדמיות', qty: 1, price: 500, vatDiscount: true });
  });

  it('pressed again, clears it to nothing', () => {
    const setWorks = vi.fn();
    render(<WorksStep works={[work(true)]} setWorks={setWorks} />);
    expect(toggle().getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(toggle());

    const [next] = setWorks.mock.lastCall![0] as TicketWork[];
    expect(next.items[0].vatDiscount).toBeUndefined();
    expect(next.items[0].price).toBe(500);
  });
});
