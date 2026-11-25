import { Fragment, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import styles from './KeyValue.module.css';

export interface KeyValueItem {
  /** i18n key. */
  label: string;
  /** null or undefined shows as a dash. */
  value: ReactNode;
}

/** Label/value pairs, two columns. */
export function KeyValue({ items }: { items: readonly KeyValueItem[] }) {
  const { t } = useTranslation();
  return (
    <dl className={styles.list}>
      {items.map((item) => (
        <Fragment key={item.label}>
          <dt>{t(item.label)}</dt>
          <dd>{item.value ?? <span className={styles.none}>—</span>}</dd>
        </Fragment>
      ))}
    </dl>
  );
}
