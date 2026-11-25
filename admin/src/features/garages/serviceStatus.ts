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

/* ---------- the row as a whole ---------- */

export interface GarageIssue {
  tone: 'warn' | 'danger';
  /** i18n key under console.issues. */
  key: string;
}

/** What needs someone's attention, worst first. An empty list is a garage
 *  that is set up as far as the console can tell. */
export function garageIssues(g: GarageOverview): GarageIssue[] {
  const issues: GarageIssue[] = [];
  if (!g.members.some((m) => m.role === 'admin')) issues.push({ tone: 'danger', key: 'console.issues.noAdmin' });
  if (g.invoicing && !g.invoicing.credentials) issues.push({ tone: 'danger', key: 'console.issues.noCredentials' });
  if (g.payments?.authFailedAt) issues.push({ tone: 'danger', key: 'console.issues.paymentsSuspended' });
  if (g.invoicing?.credentials && !g.invoicing.active) issues.push({ tone: 'warn', key: 'console.issues.invoicingOff' });
  if (g.invoicing && g.bookkeeping?.software === null) issues.push({ tone: 'warn', key: 'console.issues.noSoftware' });
  return issues;
}

/* The automated suites (isolation, e2e, ops tests) leave garages behind whose
   every user is a made-up address. They outnumber the real ones on local. */
const TEST_EMAIL = /@(garage\.test|test\.local)$/i;

export const isAutomatedTestGarage = (g: GarageOverview): boolean =>
  g.members.length > 0 && g.members.every((m) => TEST_EMAIL.test(m.email));

/** The most recent sign-in of anyone in the garage — is it in use at all. */
export function lastActivity(g: GarageOverview): string | null {
  let latest: string | null = null;
  for (const m of g.members) {
    if (m.lastSignIn && (!latest || m.lastSignIn > latest)) latest = m.lastSignIn;
  }
  return latest;
}

/** Search across what someone would type: name, any user's email, the id. */
export function matchesQuery(g: GarageOverview, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return g.name.toLowerCase().includes(q)
    || g.id.startsWith(q)
    || g.members.some((m) => m.email.toLowerCase().includes(q))
    || (g.letterhead.taxId ?? '').includes(q);
}
