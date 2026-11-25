import { describe, expect, it } from 'vitest';
import { validateOnboarding } from '../../../../packages/ops/src/onboarding/rules';
import { emptyForm, toInput, type OnboardingForm } from './formState';

const filled = (over: Partial<OnboardingForm> = {}): OnboardingForm => ({
  ...emptyForm('staging'),
  confirmEnv: 'staging',
  name: ' מוסך הרצל ',
  email: ' Avi@Example.com ',
  ...over,
});

describe('toInput', () => {
  it('sends nothing optional for a bare garage', () => {
    const input = toInput(filled());
    expect(input).toMatchObject({
      garage: { name: 'מוסך הרצל', letterhead: {}, seedCatalog: false },
      admin: { email: 'Avi@Example.com', password: '' },
      invoicing: null,
      bookkeeping: null,
      payments: null,
    });
    expect(validateOnboarding(input)).toEqual({});
  });

  it('sends only the letterhead fields that were filled', () => {
    const form = filled();
    form.letterhead.phone = ' 02-6522306 ';
    expect(toInput(form).garage.letterhead).toEqual({ phone: '02-6522306' });
  });

  it('turns a VAT percent into a fraction without float noise', () => {
    expect(toInput(filled({ invoicingOn: true, vatPercent: '18' })).invoicing?.vatRate).toBe(0.18);
    expect(toInput(filled({ invoicingOn: true, vatPercent: '17.5' })).invoicing?.vatRate).toBe(0.175);
  });

  it('reads a blank number as invalid, not as zero', () => {
    const input = toInput(filled({ paymentsMode: 'installments', maxInstallments: '' }));
    expect(validateOnboarding(input)).toEqual({ 'payments.maxInstallments': 'maxInstallments' });
  });

  it('never sends credentials or "on" in installments-only mode', () => {
    const input = toInput(filled({ paymentsMode: 'installments', terminal: '123', paymentsActive: true }));
    expect(input.payments).toMatchObject({ credentials: null, active: false, shopNo: '' });
  });

  it('sends the terminal credentials in Pelecard mode', () => {
    const input = toInput(filled({
      paymentsMode: 'pelecard', terminal: ' 0882577012 ', terminalUser: 'u', terminalPassword: 'p', paymentsActive: true,
    }));
    expect(input.payments).toMatchObject({ credentials: { terminal: '0882577012', user: 'u', password: 'p' }, active: true });
    expect(validateOnboarding(input)).toEqual({});
  });
});
