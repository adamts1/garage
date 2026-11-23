import { useTranslation } from 'react-i18next';
import type { EnvId, EnvironmentInfo } from '../../../api/types';
import { Note, Section, SelectField } from '../../../components';
import styles from '../OnboardingPage.module.css';
import type { OnboardingApi } from '../useOnboarding';

export function EnvironmentSection({ api, envs }: { api: OnboardingApi; envs: readonly EnvironmentInfo[] }) {
  const { t } = useTranslation();
  const { form, update } = api;
  return (
    <Section title="console.onboard.env.title">
      <div className={styles.grid}>
        <SelectField
          label="console.onboard.env.label"
          value={form.env}
          onChange={(e) => update('env', e.target.value as EnvId)}
        >
          {envs.map((env) => <option key={env.id} value={env.id}>{env.label}</option>)}
        </SelectField>
      </div>
      {form.env === 'production' && <Note tone="danger">{t('console.onboard.env.production')}</Note>}
    </Section>
  );
}
