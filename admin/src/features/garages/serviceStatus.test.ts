import { describe, expect, it } from 'vitest';
import type { GarageOverview } from '../../api/types';
import { bookkeepingStatus, invoicingStatus, paymentsStatus } from './serviceStatus';

const garage = (over: Partial<GarageOverview> = {}): GarageOverview => ({
  id: 'g', name: 'G', createdAt: '2026-11-01',
  letterhead: { printName: null, motto: null, services: null, address: null, phone: null, fax: null, licenseNo: null, taxId: null },
  members: [], invoicing: null, bookkeeping: null, payments: null,
  ...over,
});

const invoicing = { provider: 'icount', active: true, docType: 'invoice_receipt' as const, vatRate: 0.18, credentials: true, updatedAt: '' };
const payments = {
  provider: 'pelecard', active: true, shopNo: null, maxInstallments: 12, installmentsMin: 0,
  credentials: true, authFailedAt: null, authError: null, updatedAt: '',
};

describe('invoicingStatus', () => {
  it('is neutral when not connected', () => {
    expect(invoicingStatus(garage()).tone).toBe('neutral');
  });
  it('is red when settings exist without credentials — issuing would fail', () => {
    expect(invoicingStatus(garage({ invoicing: { ...invoicing, credentials: false } })).tone).toBe('danger');
  });
  it('tells active from switched off', () => {
    expect(invoicingStatus(garage({ invoicing })).tone).toBe('ok');
    expect(invoicingStatus(garage({ invoicing: { ...invoicing, active: false } })).tone).toBe('warn');
  });
});

describe('paymentsStatus', () => {
  it('puts a suspension above everything else', () => {
    const s = paymentsStatus(garage({ payments: { ...payments, authFailedAt: '2026-11-20', authError: 'bad password' } }));
    expect(s).toMatchObject({ tone: 'danger', label: 'console.services.suspended', titleValues: { error: 'bad password' } });
  });
  it('reads a row with no credentials as installments only, not as a broken provider', () => {
    expect(paymentsStatus(garage({ payments: { ...payments, credentials: false, active: false } })).label)
      .toBe('console.services.installmentsOnly');
  });
  it('says when a physical terminal is connected', () => {
    expect(paymentsStatus(garage({ payments: { ...payments, shopNo: '3' } })).label).toBe('console.services.activeTerminal');
  });
});

describe('bookkeepingStatus', () => {
  it('tells a missing column from an unset value', () => {
    expect(bookkeepingStatus(garage({ bookkeeping: { software: undefined, accountantEmail: undefined } })).label)
      .toBe('console.services.unknown');
    expect(bookkeepingStatus(garage({ bookkeeping: { software: null, accountantEmail: null } })).tone).toBe('warn');
  });
  it('names the software', () => {
    expect(bookkeepingStatus(garage({ bookkeeping: { software: 'hashavshevet', accountantEmail: null } })).label)
      .toBe('console.software.hashavshevet');
  });
});
