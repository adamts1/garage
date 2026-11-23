import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { EnvironmentInfo } from '../../api/types';
import { Button } from '../app';
import { Section } from '../Section/Section';
import styles from './EnvSection.module.css';

/** The environment's name with its colour dot: grey local, amber staging, red
 *  production — the same colour wherever an environment is named. */
export function EnvName({ env, showRef = false }: { env: EnvironmentInfo; showRef?: boolean }) {
  return (
    <span className={styles.name}>
      <span className={`${styles.dot} ${styles[env.id]}`} aria-hidden="true" />
      {env.label}
      {showRef && env.ref && <code className={styles.ref}>{env.ref}</code>}
    </span>
  );
}

export interface EnvSectionProps {
  env: EnvironmentInfo;
  loading: boolean;
  onReload: () => void;
  aside?: ReactNode;
  /** Replaces the default reload button's label (i18n key). */
  reloadLabel?: string;
  children?: ReactNode;
}

/** A section about one environment, with a reload button. */
export function EnvSection({ env, loading, onReload, aside, reloadLabel = 'console.common.reload', children }: EnvSectionProps) {
  const { t } = useTranslation();
  return (
    <Section
      title={<EnvName env={env} showRef />}
      aside={aside}
      actions={
        <Button size="sm" onClick={onReload} disabled={loading}>
          {loading ? t('console.common.loading') : t(reloadLabel)}
        </Button>
      }
    >
      {children}
    </Section>
  );
}
