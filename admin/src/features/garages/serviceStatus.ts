/* What a garage's services amount to, as a pill: tone, label key, and a title
   for the hover. Pure, so the rules are tested rather than eyeballed. */

import type { PillTone } from '../../components';
import type { GarageOverview } from '../../api/types';

export interface ServiceStatus {
  tone: PillTone;
  /** i18n key. */
  label: string;
  values?: Record<string, string | number>;
  /** i18n key for the hover text. */
  title?: string;
  titleValues?: Record<string, string | number>;
}

export const PROVIDER_NAMES: Record<string, string> = { icount: 'iCount', pelecard: 'Pelecard' };
export const providerName = (p: string): string => PROVIDER_NAMES[p] ?? p;

export function invoicingStatus(g: GarageOverview): ServiceStatus {
  const b = g.invoicing;
  if (!b) return { tone: 'neutral', label: 'console.services.notConnected' };
  const values = { provider: providerName(b.provider) };
  if (!b.credentials) {
    return { tone: 'danger', label: 'console.services.noCredentials', values, title: 'console.services.noCredentialsHint' };
  }
  return b.active
    ? { tone: 'ok', label: 'console.services.active', values }
    : { tone: 'warn', label: 'console.services.inactive', values };
}

export function paymentsStatus(g: GarageOverview): ServiceStatus {
  const p = g.payments;
  if (!p) return { tone: 'neutral', label: 'console.services.notConnected' };
  const values = { provider: providerName(p.provider), max: p.maxInstallments };
  if (p.authFailedAt) {
    return { tone: 'danger', label: 'console.services.suspended', values, title: 'console.services.suspendedHint', titleValues: { error: p.authError ?? '' } };
  }
  if (!p.credentials) return { tone: 'neutral', label: 'console.services.installmentsOnly', values, title: 'console.services.installmentsOnlyHint' };
  if (!p.active) return { tone: 'warn', label: 'console.services.inactive', values };
  return { tone: 'ok', label: p.shopNo ? 'console.services.activeTerminal' : 'console.services.active', values };
}

export function bookkeepingStatus(g: GarageOverview): ServiceStatus {
  const k = g.bookkeeping;
  if (!k) return { tone: 'neutral', label: 'console.services.none' };
  if (k.software === undefined) return { tone: 'neutral', label: 'console.services.unknown', title: 'console.services.unknownHint' };
  if (!k.software) return { tone: 'warn', label: 'console.services.noSoftware', title: 'console.services.noSoftwareHint' };
  return { tone: 'ok', label: `console.software.${k.software}` };
}
