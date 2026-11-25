import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import styles from './StatCard.module.css';

export type StatTone = 'plain' | 'ok' | 'attention';

/** A headline number. 'attention' tints the whole card — it is the one that
 *  asks for something — while 'ok' colours only the number. */
export function StatCard({ label, value, sub, subValues, tone = 'plain' }: {
  /** i18n keys. */
  label: string;
  value: string;
  sub?: string;
  subValues?: Record<string, string | number>;
  tone?: StatTone;
}) {
  const { t } = useTranslation();
  return (
    <div className={`${styles.card} ${styles[tone]}`}>
      <span className={styles.label}>{t(label)}</span>
      <span className={styles.value} dir="ltr">{value}</span>
      {sub && <span className={styles.sub}>{t(sub, subValues)}</span>}
    </div>
  );
}

export function StatRow({ children }: { children: ReactNode }) {
  return <div className={styles.row}>{children}</div>;
}
