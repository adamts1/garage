import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import styles from './KpiCard.module.css';

export type KpiTone = 'ok' | 'warn' | 'danger' | 'slate' | 'navy';

export interface KpiCardProps {
  /** i18n key. */
  label: string;
  /** Already formatted — money and counts are the caller's to shape. */
  value: string;
  /** i18n key for the line under the number. */
  sub?: string;
  subValues?: Record<string, string | number>;
  icon?: ReactNode;
  tone?: KpiTone;
}

/** One headline number. There were two of these — invoices had the icon beside
 *  the value, reports had it above — written a fortnight apart and never
 *  reconciled. This is reports' layout, which reads better at six across. */
export default function KpiCard({
  label, value, sub, subValues, icon, tone = 'slate',
}: KpiCardProps) {
  const { t } = useTranslation();

  return (
    <div className={`${styles.card} ${styles[tone]}`}>
      <div className={styles.top}>
        <span className={styles.label}>{t(label)}</span>
        {icon && <span className={styles.icon}>{icon}</span>}
      </div>
      {/* Money and counts read left-to-right even on an RTL page: "₪1,200"
          reversed is not a number anyone recognises. */}
      <div className={styles.value} dir="ltr">{value}</div>
      {sub && <div className={styles.sub}>{t(sub, subValues)}</div>}
    </div>
  );
}

/** The grid the cards sit in. Wraps to fit however many there are. */
export function KpiRow({ children }: { children: ReactNode }) {
  return <div className={styles.row}>{children}</div>;
}
