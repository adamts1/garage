import { describe, expect, it } from 'vitest';
import type { OnboardingInput } from '../types.ts';
import { letterheadColumns, PELECARD_TEST_TERMINAL, terminalProblem, validateOnboarding } from './rules.ts';

const base = (over: Partial<OnboardingInput> = {}): OnboardingInput => ({
  env: 'staging',
  confirmEnv: 'staging',
  garage: { name: 'מוסך הרצל', letterhead: {}, seedCatalog: false },
  admin: { email: 'avi@example.com', password: '' },
  invoicing: null,
  bookkeeping: null,
  payments: null,
  ...over,
});

const invoicing = { provider: 'icount' as const, cid: 'c', token: 't', vatRate: 0.18, docType: 'invoice_receipt' as const, active: true };
const payments = {
  credentials: { terminal: PELECARD_TEST_TERMINAL, user: 'u', password: 'p' },
  shopNo: '', maxInstallments: 12, installmentsMin: 0, active: true, allowTestTerminal: false, realTerminal: false,
};

describe('validateOnboarding', () => {
  it('accepts a minimal garage with a generated password', () => {
    expect(validateOnboarding(base())).toEqual({});
  });

  it('demands the environment be typed back exactly', () => {
    expect(validateOnboarding(base({ env: 'production', confirmEnv: 'staging' }))).toEqual({ confirmEnv: 'confirmEnv' });
    expect(validateOnboarding(base({ env: 'production', confirmEnv: '' }))).toEqual({ confirmEnv: 'confirmEnv' });
  });

  it('needs a name and a real email', () => {
    const errors = validateOnboarding(base({
      garage: { name: '  ', letterhead: {}, seedCatalog: false },
      admin: { email: 'not-an-email', password: '' },
    }));
    expect(errors).toEqual({ 'garage.name': 'required', 'admin.email': 'email' });
  });

  it('refuses a short chosen password, not an empty one', () => {
    expect(validateOnboarding(base({ admin: { email: 'a@b.co', password: '123' } })))
      .toEqual({ 'admin.password': 'passwordTooShort' });
  });

  it('checks the invoicing credentials and the VAT fraction', () => {
    expect(validateOnboarding(base({ invoicing: { ...invoicing, token: '', vatRate: 18 } })))
      .toEqual({ 'invoicing.token': 'required', 'invoicing.vatRate': 'vatRate' });
  });

  it('refuses bookkeeping settings without invoicing — they live on garage_billing', () => {
    expect(validateOnboarding(base({ bookkeeping: { software: 'rivhit', accountantEmail: '' } })))
      .toEqual({ 'bookkeeping.software': 'needsInvoicing' });
    expect(validateOnboarding(base({ invoicing, bookkeeping: { software: 'rivhit', accountantEmail: '' } })))
      .toEqual({});
  });

  it('checks installments limits', () => {
    expect(validateOnboarding(base({ payments: { ...payments, maxInstallments: 40, installmentsMin: -1 } })))
      .toEqual({ 'payments.maxInstallments': 'maxInstallments', 'payments.installmentsMin': 'installmentsMin' });
  });

  it('will not switch card payments on with no provider', () => {
    expect(validateOnboarding(base({ payments: { ...payments, credentials: null, active: true } })))
      .toEqual({ 'payments.active': 'activeNeedsProvider' });
    expect(validateOnboarding(base({ payments: { ...payments, credentials: null, active: false } })))
      .toEqual({});
  });
});

describe('terminalProblem', () => {
  const none = { allowTestTerminal: false, realTerminal: false };

  it('refuses the test terminal on production unless allowed', () => {
    expect(terminalProblem('production', PELECARD_TEST_TERMINAL, none)).toBe('testTerminalOnProduction');
    expect(terminalProblem('production', PELECARD_TEST_TERMINAL, { ...none, allowTestTerminal: true })).toBeNull();
  });

  it('needs a real terminal confirmed anywhere but production', () => {
    expect(terminalProblem('staging', '1234567', none)).toBe('realTerminalNotConfirmed');
    expect(terminalProblem('local', '1234567', { ...none, realTerminal: true })).toBeNull();
    expect(terminalProblem('staging', PELECARD_TEST_TERMINAL, none)).toBeNull();
    expect(terminalProblem('production', '1234567', none)).toBeNull();
  });
});

describe('letterheadColumns', () => {
  it('writes only the fields given, and clears a field given as empty', () => {
    expect(letterheadColumns({ phone: ' 02-1 ', fax: '', printName: undefined }))
      .toEqual({ phone: '02-1', fax: null });
  });

  it('maps every field to its column', () => {
    expect(Object.keys(letterheadColumns({ licenseNo: '1', taxId: '2', printName: '3' })).sort())
      .toEqual(['license_no', 'print_name', 'tax_id']);
  });
});
