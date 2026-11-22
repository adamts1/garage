// @vitest-environment jsdom

/* The confirmation after money went back to a card: the provider's answer, in
   full, as the credit note prints it. */

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

await import('../../i18n');
const { default: RefundDoneModal } = await import('./RefundDoneModal');

const open = (props: Record<string, string | number>) =>
  render(<RefundDoneModal id="m1" isTop stacked={false} onClose={() => {}} props={{ resultId: 'r1', ...props }} />);

afterEach(cleanup);

describe('refund confirmation', () => {
  it('a void says so, with every detail the credit note carries', () => {
    open({
      kind: 'cancel', amount: 94.4, cardBrand: 'יורוקרד מסטרקרד', cardLast4: '9154',
      approvalNumber: '5297834', providerRefundId: '3204695092', originalRef: '3204693659',
      docnum: '5009', noteTotal: 94.4,
    });
    expect(screen.getByText('עסקת האשראי בוטלה!')).toBeTruthy();
    expect(screen.getByText('ביטול עסקה')).toBeTruthy();
    expect(screen.getByText('יורוקרד מסטרקרד · ****9154')).toBeTruthy();
    expect(screen.getByText('5297834')).toBeTruthy();
    expect(screen.getByText('3204695092')).toBeTruthy();
    expect(screen.getByText('3204693659')).toBeTruthy();
    expect(screen.getByText('#5009')).toBeTruthy();
  });

  it('a refund to the card reads as one', () => {
    open({ kind: 'refund', amount: 84.41, cardLast4: '9154', approvalNumber: '5297828', docnum: '5008', noteTotal: 84.41 });
    expect(screen.getByText('הכסף הוחזר לכרטיס!')).toBeTruthy();
    expect(screen.getByText('זיכוי לכרטיס')).toBeTruthy();
  });
});
