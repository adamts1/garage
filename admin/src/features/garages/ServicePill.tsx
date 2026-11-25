import { useTranslation } from 'react-i18next';
import { Pill } from '../../components';
import styles from './GaragesPage.module.css';
import type { ServiceStatus } from './serviceStatus';

export function ServicePill({ status }: { status: ServiceStatus }) {
  const { t } = useTranslation();
  /* Nothing connected is not a state to look at: plain muted text, so the
     pills that remain are the ones that say something. */
  if (status.tone === 'neutral' && (status.label === 'console.services.notConnected' || status.label === 'console.services.none')) {
    return <span className={styles.none}>{t(status.label, status.values)}</span>;
  }
  return (
    <Pill tone={status.tone} title={status.title ? t(status.title, status.titleValues) : undefined}>
      {t(status.label, status.values)}
    </Pill>
  );
}
