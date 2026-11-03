// @vitest-environment jsdom

/* Renaming a part on a ticket. The name is the ticket's own copy — the catalog
 * item it came from is not involved — so the rename lands in the ticket's works
 * and nowhere else. */

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

describe('renaming a part on the ticket', () => {
  it('changes that line of this ticket and keeps its sku', () => {
    const setWorks = vi.fn();
    render(<WorksStep works={[work]} setWorks={setWorks} />);

    // i18next is not initialised here, so the label is the key.
    fireEvent.change(screen.getByLabelText('works.fields.part'), { target: { value: 'רפידות Brembo' } });

    const [next] = setWorks.mock.lastCall![0] as TicketWork[];
    expect(next.items[0]).toEqual({ sku: 'PAD-1', name: 'רפידות Brembo', qty: 1, price: 200 });
    expect(next.name).toBe('החלפת רפידות');
  });
});
