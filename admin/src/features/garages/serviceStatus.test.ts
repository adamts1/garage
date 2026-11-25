import { describe, expect, it } from 'vitest';
import type { GarageOverview } from '../../api/types';
import {
  bookkeepingStatus, garageIssues, invoicingStatus, isAutomatedTestGarage, lastActivity, matchesQuery, paymentsStatus,
} from './serviceStatus';

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

const admin = { email: 'owner@garage.co.il', role: 'admin' as const, lastSignIn: '2026-11-20T08:00:00Z' };

describe('garageIssues', () => {
  it('is empty for a garage that is set up', () => {
    expect(garageIssues(garage({ members: [admin], invoicing, bookkeeping: { software: 'rivhit', accountantEmail: null } }))).toEqual([]);
  });
  it('puts a missing admin and missing credentials first, in red', () => {
    const issues = garageIssues(garage({ invoicing: { ...invoicing, credentials: false } }));
    expect(issues.map((i) => i.key)).toEqual(['console.issues.noAdmin', 'console.issues.noCredentials']);
    expect(issues.every((i) => i.tone === 'danger')).toBe(true);
  });
  it('warns when invoicing is switched off, not when it was never connected', () => {
    expect(garageIssues(garage({ members: [admin], invoicing: { ...invoicing, active: false } })).map((i) => i.key))
      .toEqual(['console.issues.invoicingOff']);
    expect(garageIssues(garage({ members: [admin] }))).toEqual([]);
  });
  it('flags a suspended terminal and an unchosen bookkeeping program', () => {
    const keys = garageIssues(garage({
      members: [admin], invoicing,
      payments: { ...payments, authFailedAt: '2026-11-01' },
      bookkeeping: { software: null, accountantEmail: null },
    })).map((i) => i.key);
    expect(keys).toEqual(['console.issues.paymentsSuspended', 'console.issues.noSoftware']);
  });
});

describe('isAutomatedTestGarage', () => {
  it('is true only when every user is a made-up test address', () => {
    expect(isAutomatedTestGarage(garage({ members: [{ ...admin, email: 'iso-a-1@garage.test' }] }))).toBe(true);
    expect(isAutomatedTestGarage(garage({ members: [{ ...admin, email: 'e2e-1@test.local' }] }))).toBe(true);
    expect(isAutomatedTestGarage(garage({ members: [{ ...admin, email: 'iso-a-1@garage.test' }, admin] }))).toBe(false);
    expect(isAutomatedTestGarage(garage())).toBe(false);
  });
});

describe('lastActivity and matchesQuery', () => {
  it('takes the latest sign-in of anyone', () => {
    const later = { ...admin, email: 'b@x.co', lastSignIn: '2026-11-24T08:00:00Z' };
    expect(lastActivity(garage({ members: [admin, later, { ...admin, lastSignIn: null }] }))).toBe(later.lastSignIn);
    expect(lastActivity(garage())).toBeNull();
  });
  it('finds by name, email or id prefix', () => {
    const g = garage({ id: 'abc-123', name: 'מוסך אלון', members: [admin] });
    expect(matchesQuery(g, 'אלון')).toBe(true);
    expect(matchesQuery(g, 'OWNER@')).toBe(true);
    expect(matchesQuery(g, 'abc')).toBe(true);
    expect(matchesQuery(g, 'zzz')).toBe(false);
  });
});
