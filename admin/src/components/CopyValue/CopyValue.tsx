import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../app';
import styles from './CopyValue.module.css';

/** A value shown left-to-right (ids, emails, passwords) with a copy button. */
export function CopyValue({ value }: { value: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const copy = () => {
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <span className={styles.wrap}>
      <code className={styles.value}>{value}</code>
      <Button size="sm" onClick={copy}>{copied ? t('console.common.copied') : t('console.common.copy')}</Button>
    </span>
  );
}
