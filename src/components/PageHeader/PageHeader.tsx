import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import styles from './PageHeader.module.css';

export interface PageHeaderProps {
  /** i18n key. */
  title: string;
  /** The pill beside the title. Omit it rather than passing 0 when a count is
   *  not meaningful for the screen. */
  count?: number;
  /** Buttons for the far end of the bar. */
  actions?: ReactNode;
}

/** The bar every CRUD screen opens with. It was the same eight lines of markup
 *  copied onto each one, which is how three of them ended up with a count that
 *  meant something slightly different. */
export default function PageHeader({ title, count, actions }: PageHeaderProps) {
  const { t } = useTranslation();

  return (
    <div className={styles.header}>
      <h2 className={styles.title}>
        {t(title)}
        {count !== undefined && <span className={styles.count}>{count}</span>}
      </h2>
      {actions && <div className={styles.actions}>{actions}</div>}
    </div>
  );
}
