import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import styles from './EmptyState.module.css';

export interface EmptyStateProps {
  /** i18n key. */
  title: string;
  /** i18n key for the explanation under it. */
  body?: string;
  bodyValues?: Record<string, string | number>;
  icon?: ReactNode;
  /** Bigger icon for a whole-panel empty, as against an empty inside a card. */
  large?: boolean;
  actions?: ReactNode;
}

/**
 * "Nothing here" told properly — what is missing, and why.
 *
 * Worth a component because the distinction is easy to lose: "no invoices yet"
 * and "no invoices match this filter" look the same to whoever wrote the
 * template and completely different to whoever is reading it.
 */
export default function EmptyState({
  title, body, bodyValues, icon, large, actions,
}: EmptyStateProps) {
  const { t } = useTranslation();

  return (
    <div className={styles.empty}>
      {icon && (
        <span className={[styles.icon, large ? styles.big : null].filter(Boolean).join(' ')}>
          {icon}
        </span>
      )}
      <h4 className={styles.title}>{t(title)}</h4>
      {body && <p className={styles.body}>{t(body, bodyValues)}</p>}
      {actions && <div className={styles.actions}>{actions}</div>}
    </div>
  );
}
