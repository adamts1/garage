import { useTranslation } from 'react-i18next';
import type { EnvironmentInfo } from '../../../api/types';
import { Button, EnvName, Note, Section, TextField } from '../../../components';
import { plannedSteps } from '../plannedSteps';
import styles from '../OnboardingPage.module.css';
import type { OnboardingApi } from '../useOnboarding';

/** What is about to happen, and the typed confirmation of where. */
export function ConfirmSection({ api, env }: { api: OnboardingApi; env: EnvironmentInfo }) {
  const { t } = useTranslation();
  const { form, input, update, errorFor, submit, submitting, attempted, valid, serverError } = api;

  return (
    <Section title="console.onboard.confirm.title">
      <p className={styles.subnote}>
        {t('console.onboard.confirm.into')} <EnvName env={env} showRef />
      </p>
      <ol className={styles.plan}>
        {plannedSteps(input).map((s) => <li key={s.id}>{t(`console.onboard.steps.${s.key}`, s.values)}</li>)}
      </ol>

      <div className={styles.grid}>
        <TextField
          label="console.onboard.confirm.type"
          labelValues={{ env: form.env }}
          dir="ltr"
          autoComplete="off"
          value={form.confirmEnv}
          onChange={(e) => update('confirmEnv', e.target.value)}
          error={errorFor('confirmEnv')}
        />
      </div>

      {attempted && !valid && <Note tone="danger">{t('console.onboard.confirm.fixErrors')}</Note>}
      {serverError && <Note tone="danger">{t('console.common.error', { message: serverError })}</Note>}

      <div className={styles.submit}>
        <Button variant="primary" size="lg" onClick={() => void submit()} disabled={submitting}>
          {submitting ? t('console.onboard.confirm.working') : t('console.onboard.confirm.submit')}
        </Button>
      </div>
    </Section>
  );
}
