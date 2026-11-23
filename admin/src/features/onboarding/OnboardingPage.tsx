import type { EnvironmentInfo } from '../../api/types';
import { OnboardingResultView } from './OnboardingResultView';
import { AdminSection } from './sections/AdminSection';
import { ConfirmSection } from './sections/ConfirmSection';
import { EnvironmentSection } from './sections/EnvironmentSection';
import { GarageSection } from './sections/GarageSection';
import { InvoicingSection } from './sections/InvoicingSection';
import { PaymentsSection } from './sections/PaymentsSection';
import { useOnboarding } from './useOnboarding';

/** A new garage with everything it needs, in one form: the same steps, in the
 *  same order and through the same code, as the onboarding scripts. */
export function OnboardingPage({ envs }: { envs: readonly EnvironmentInfo[] }) {
  const api = useOnboarding();
  const env = envs.find((e) => e.id === api.form.env) ?? envs[0];

  if (api.result) return <OnboardingResultView result={api.result} onAnother={() => api.reset(api.form.env)} />;

  return (
    <>
      <EnvironmentSection api={api} envs={envs} />
      <GarageSection api={api} />
      <AdminSection api={api} />
      <InvoicingSection api={api} />
      <PaymentsSection api={api} />
      {env && <ConfirmSection api={api} env={env} />}
    </>
  );
}
