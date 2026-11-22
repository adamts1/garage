// @vitest-environment jsdom

/* The credit dialog, for a bill paid by a card the clearing provider charged.
 *
 * Pinned: the refund to the card is offered and ticked; it is never more than
 * the card can still take back, and the dialog says how much has to go back
 * some other way; and while an earlier refund has no clear answer, no new one
 * can be asked for from here. */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

await import('../../i18n');
const { default: CreditNoteModal } = await import('./CreditNoteModal');

const open = (extra: Record<string, string | number | boolean> = {}) =>
  render(
    <CreditNoteModal
      id="m1"
      isTop
      stacked={false}
      onClose={() => {}}
      props={{ resultId: 'r1', remaining: 1180, invoiceTotal: 1180, docnum: '20451', customer: 'דנה', vatRate: 0.18, ...extra }}
    />,
  );

const box = () => screen.getByRole('checkbox') as HTMLInputElement;

afterEach(cleanup);

describe('crediting a bill paid by card', () => {
  it('offers the refund to the card, ticked', () => {
    open({ cardRefundable: 1180, cardLast4: '0772' });
    expect(box().checked).toBe(true);
    expect(screen.getByText(/החזר לכרטיס האשראי \*\*\*\*0772/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /החזר לכרטיס והפק חשבונית זיכוי/ })).toBeTruthy();
  });

  it('returns no more than the card can take, and says where the rest goes', () => {
    open({ cardRefundable: 500, cardLast4: '0772' });
    expect(screen.getByText(/יוחזרו ₪500.00 לכרטיס/)).toBeTruthy();
    expect(screen.getByText(/את היתרה, ₪680.00, יש להחזיר בדרך אחרת/)).toBeTruthy();
  });

  it('can be unticked — the customer took the money back in cash', () => {
    open({ cardRefundable: 1180, cardLast4: '0772' });
    fireEvent.click(box());
    expect(box().checked).toBe(false);
    expect(screen.getByRole('button', { name: /^הפק חשבונית זיכוי$/ })).toBeTruthy();
  });

  it('offers nothing while an earlier refund has no clear answer', () => {
    open({ cardRefundable: 1180, cardLast4: '0772', cardUnresolved: true });
    expect(box().checked).toBe(false);
    expect(box().disabled).toBe(true);
    expect(screen.getByText(/החזר קודם לכרטיס הזה עדיין לא אושר/)).toBeTruthy();
  });

  it('offers no refund for a bill not paid by such a card', () => {
    open();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });
});
