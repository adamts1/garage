import { useTranslation } from 'react-i18next';
import type { OnboardingResult } from '../../api/types';
import { Button, CopyValue, KeyValue, Note, Pill, Section } from '../../components';
import styles from './OnboardingPage.module.css';

/** What happened, step by step — and the login, shown once. */
export function OnboardingResultView({ result, onAnother }: { result: OnboardingResult; onAnother: () => void }) {
  const { t } = useTranslation();

  return (
    <Section
      title={result.ok ? 'console.onboard.result.ok' : 'console.onboard.result.failed'}
      aside={<Pill tone={result.ok ? 'ok' : 'danger'}>{result.projectRef}</Pill>}
      actions={<Button onClick={onAnother}>{t('console.onboard.result.another')}</Button>}
    >
      {!result.ok && <Note tone="danger">{t('console.common.error', { message: result.error ?? '' })}</Note>}
      {!result.ok && result.garageId && <Note tone="warn">{t('console.onboard.result.partial')}</Note>}

      <ul className={styles.steps}>
        {result.steps.map((s) => (
          <li key={s.id}>
            <Pill tone={s.ok ? 'ok' : 'danger'}>{s.ok ? '✓' : '✗'}</Pill>
            {t(`console.onboard.stepsDone.${s.id}`)}
            {s.detail && <span className={styles.detail}>{s.detail}</span>}
          </li>
        ))}
      </ul>

      <KeyValue
        items={[
          { label: 'console.garages.id', value: result.garageId && <CopyValue value={result.garageId} /> },
          { label: 'console.onboard.admin.email', value: result.login && <CopyValue value={result.login.email} /> },
          {
            label: 'console.onboard.admin.password',
            value: result.login?.password
              ? <CopyValue value={result.login.password} />
              : result.login?.existingUser ? t('console.onboard.result.existingUser') : t('console.onboard.result.chosenPassword'),
          },
        ]}
      />
      {result.login?.password && <Note tone="warn">{t('console.onboard.result.passwordOnce')}</Note>}
    </Section>
  );
}
