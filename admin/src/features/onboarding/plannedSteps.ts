import type { OnboardingInput, OnboardingStepId } from '../../api/types';

export interface PlannedStep {
  id: OnboardingStepId;
  /** i18n key under console.onboard.steps. */
  key: string;
  values?: Record<string, string | number>;
}

/** The steps a submit will run, in the order the server runs them (see
 *  onboardGarage in packages/ops) — said before anything is written. */
export function plannedSteps(input: OnboardingInput): PlannedStep[] {
  const steps: PlannedStep[] = [
    { id: 'garage', key: 'garage', values: { name: input.garage.name || '—' } },
    { id: 'user', key: 'user', values: { email: input.admin.email || '—' } },
    { id: 'membership', key: 'membership' },
  ];
  if (input.garage.seedCatalog) steps.push({ id: 'catalog', key: 'catalog' });
  if (input.invoicing) steps.push({ id: 'invoicing', key: input.invoicing.active ? 'invoicingOn' : 'invoicingOff' });
  if (input.bookkeeping) steps.push({ id: 'bookkeeping', key: 'bookkeeping' });
  if (input.payments) {
    const key = !input.payments.credentials ? 'paymentsInstallments' : input.payments.active ? 'paymentsOn' : 'paymentsOff';
    steps.push({ id: 'payments', key });
  }
  steps.push({ id: 'verify', key: 'verify' });
  return steps;
}
