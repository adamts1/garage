import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import styles from './PageHeader.module.css';

export interface PageHeaderProps {
  /** i18n key. */
  title: string;
  /** i18n key for the line under the title. */
  subtitle?: string;
  /** The pill beside the title. Omit it rather than passing 0 when a count is
   *  not meaningful for the screen. */
  count?: number;
  /** Buttons for the far end of the bar. */
  actions?: ReactNode;
  /** An icon before the title. */
  icon?: ReactNode;
}

/** The bar every CRUD screen opens with. It was the same eight lines of markup
 *  copied onto each one, which is how three of them ended up with a count that
 *  meant something slightly different. */
export default function PageHeader({
  title, subtitle, count, actions, icon,
}: PageHeaderProps) {
  const { t } = useTranslation();

  return (
    <div className={styles.header}>
      <div>
        <h2 className={styles.title}>
          {icon}
          {t(title)}
          {count !== undefined && <span className={styles.count}>{count}</span>}
        </h2>
        {subtitle && <p className={styles.subtitle}>{t(subtitle)}</p>}
      </div>
      {actions && <div className={styles.actions}>{actions}</div>}
    </div>
  );
}
