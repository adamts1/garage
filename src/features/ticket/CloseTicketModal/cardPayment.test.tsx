// @vitest-environment jsdom

/* Charging a card through the clearing provider, from the close drawer.
 *
 * What is pinned here is what keeps a customer from paying twice, or a ticket
 * from reading "paid by card" when no card was charged:
 *
 *   - settings that could not be read are never taken to mean "no provider";
 *   - a payment the server finds already taken is that payment, not a new one;
 *   - an earlier page that may still be completed is asked about, not ignored;
 *   - only the server's answer ("paid") moves the drawer to its success screen,
 *     and that screen shows the approval the provider gave.
 */

import type { CardPayment } from '@garage/shared';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const cardPaymentsActive = vi.fn();
const startCardPayment = vi.fn();
const verifyCardPayment = vi.fn();

vi.mock('@garage/shared', async (importActual) => {
  const actual = await importActual<typeof import('@garage/shared')>();
  return {
    ...actual,
    cardPaymentsActive: () => cardPaymentsActive(),
    startCardPayment: (...a: unknown[]) => startCardPayment(...a),
    verifyCardPayment: (...a: unknown[]) => verifyCardPayment(...a),
  };
});

await import('../../../i18n');
const { CardStartError, DEFAULT_CARD_SETTINGS } = await import('@garage/shared');
const { default: CloseTicketModal } = await import('./CloseTicketModal');

const ACTIVE = { ...DEFAULT_CARD_SETTINGS, active: true };

const payment = (over: Partial<CardPayment> = {}): CardPayment => ({
  id: '6b1f3c1e-2d4a-4c55-9b0e-0f3a3e7c9a11',
  invoiceId: null,
  ticketId: 't1',
  amount: 500,
  installments: 1,
  status: 'paid',
  approvalNumber: '5290198',
  cardLast4: '0772',
  cardBrand: 'יורוקרד מסטרקרד',
  cardType: 'mastercard',
  message: null,
  ...over,
});

const open = () =>
  render(
    <CloseTicketModal
      id="m1"
      isTop
      stacked={false}
      onClose={() => {}}
      props={{ resultId: 'r1', ticketKey: 'GAR-1', ticketNumber: '1', customer: 'לקוח', car: 'מאזדה', plate: '12-345-67', total: 500 }}
    />,
  );

/** Picks the card and walks to the last step. */
const toLastStep = async () => {
  fireEvent.click(screen.getByText('כרטיס אשראי'));
  await act(async () => {});
  fireEvent.click(screen.getByRole('button', { name: 'המשך' }));
  fireEvent.click(screen.getByRole('button', { name: 'המשך' }));
};

beforeEach(() => {
  cardPaymentsActive.mockReset();
  startCardPayment.mockReset();
  verifyCardPayment.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('card payments through the provider', () => {
  it('never records a card as paid when the garage settings could not be read', async () => {
    cardPaymentsActive.mockRejectedValue(new Error('network'));
    open();
    fireEvent.click(screen.getByText('כרטיס אשראי'));
    await act(async () => {});
    expect(screen.getByRole('alert').textContent).toContain('לא הצלחנו לבדוק את הגדרות הסליקה');
    expect((screen.getByRole('button', { name: 'המשך' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('takes a payment the server found already made, without opening a page', async () => {
    cardPaymentsActive.mockResolvedValue(ACTIVE);
    startCardPayment.mockResolvedValue({ payment: payment(), url: null, recovered: true });
    open();
    await toLastStep();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /חייב באשראי/ })); });

    expect(startCardPayment).toHaveBeenCalledTimes(1);
    expect(screen.queryByTitle('דף תשלום מאובטח')).toBeNull();
    expect(screen.getByText('התשלום התקבל!')).toBeTruthy();
    expect(screen.getByText('5290198')).toBeTruthy();
  });

  it('asks before opening a second page while an earlier one may still be paid', async () => {
    cardPaymentsActive.mockResolvedValue(ACTIVE);
    startCardPayment
      .mockRejectedValueOnce(new CardStartError('open', 'payment_open', payment({ status: 'pending' })))
      .mockResolvedValueOnce({ payment: payment({ status: 'pending' }), url: 'https://pay.example/p', recovered: false });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    open();
    await toLastStep();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /חייב באשראי/ })); });

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(startCardPayment).toHaveBeenCalledTimes(2);
    expect(startCardPayment.mock.calls[0][4]).toMatchObject({ force: false });
    expect(startCardPayment.mock.calls[1][4]).toMatchObject({ force: true });
    expect(screen.getByTitle('דף תשלום מאובטח')).toBeTruthy();
  });

  it('opens no second page when the advisor says no', async () => {
    cardPaymentsActive.mockResolvedValue(ACTIVE);
    startCardPayment.mockRejectedValue(new CardStartError('open', 'payment_open', payment({ status: 'pending' })));
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    open();
    await toLastStep();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /חייב באשראי/ })); });

    expect(startCardPayment).toHaveBeenCalledTimes(1);
    expect(screen.queryByTitle('דף תשלום מאובטח')).toBeNull();
  });

  it('moves on only when the server says paid, and shows the approval', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    cardPaymentsActive.mockResolvedValue(ACTIVE);
    startCardPayment.mockResolvedValue({ payment: payment({ status: 'pending' }), url: 'https://pay.example/p', recovered: false });
    verifyCardPayment
      .mockResolvedValueOnce(payment({ status: 'pending', approvalNumber: null }))
      .mockResolvedValueOnce(payment({ installments: 3 }));
    open();
    await toLastStep();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /חייב באשראי/ })); });
    expect(screen.getByTitle('דף תשלום מאובטח')).toBeTruthy();

    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(screen.queryByText('התשלום התקבל!')).toBeNull();

    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(screen.getByText('התשלום התקבל!')).toBeTruthy();
    expect(screen.getByText('5290198')).toBeTruthy();
    expect(screen.getByText(/0772/)).toBeTruthy();
    expect(screen.getByText('3 תשלומים')).toBeTruthy();
  });

  it('a page cancelled by the customer goes back to the form, charged nothing', async () => {
    cardPaymentsActive.mockResolvedValue(ACTIVE);
    startCardPayment.mockResolvedValue({ payment: payment({ status: 'pending' }), url: 'https://pay.example/p', recovered: false });
    verifyCardPayment.mockResolvedValue(payment({ status: 'pending', approvalNumber: null }));
    open();
    await toLastStep();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /חייב באשראי/ })); });

    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', {
        origin: window.location.origin,
        data: { type: 'card-payment-return', result: 'cancel' },
      }));
    });
    expect(verifyCardPayment).toHaveBeenCalled();
    expect(screen.queryByTitle('דף תשלום מאובטח')).toBeNull();
    expect(screen.getByText(/התשלום בוטל בדף התשלום/)).toBeTruthy();
  });
});
