// @vitest-environment jsdom

/* Typing a part's price with VAT in it. The customer was quoted ₪500 all in;
 * the line stores the pre-VAT price that comes back to ₪500 once VAT is added
 * at the end — and stores it once, not on every keystroke. */

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

const work: TicketWork = {
  uid: 'w1', code: 'BR1', name: 'החלפת רפידות', labor: 100,
  items: [{ sku: 'PAD-1', name: 'רפידות קדמיות', qty: 1, price: 200 }],
};

// i18next is not initialised here, so labels are keys.
const openGross = () => {
  fireEvent.click(screen.getByRole('button', { name: 'works.inclVat' }));
  return screen.getByLabelText('works.priceInclVat') as HTMLInputElement;
};

describe('a part price typed with VAT', () => {
  it('opens on the current price with VAT added', () => {
    render(<WorksStep works={[work]} setWorks={vi.fn()} />);
    expect(openGross().value).toBe('236');
  });

  it('stores the pre-VAT price once, on Enter', () => {
    const setWorks = vi.fn();
    render(<WorksStep works={[work]} setWorks={setWorks} />);
    const input = openGross();

    for (const v of ['5', '50', '500']) fireEvent.change(input, { target: { value: v } });
    expect(setWorks).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.blur(input);

    expect(setWorks).toHaveBeenCalledTimes(1);
    const [next] = setWorks.mock.lastCall![0] as TicketWork[];
    expect(next.items[0].price).toBe(423.73);
  });

  it('Escape leaves the price alone', () => {
    const setWorks = vi.fn();
    render(<WorksStep works={[work]} setWorks={setWorks} />);
    const input = openGross();

    fireEvent.change(input, { target: { value: '500' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(setWorks).not.toHaveBeenCalled();
    expect(screen.getByLabelText('works.fields.unitPrice')).toHaveProperty('value', '200');
  });
});
