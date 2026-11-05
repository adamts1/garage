import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../Button';
import styles from './SearchBar.module.css';

export interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  /** i18n key. Doubles as the accessible name — there is no visible label. */
  placeholder: string;
  /** Whatever else sits on the row after the reset button: counts, toggles. */
  children?: ReactNode;
}

/**
 * The free-text search above a list: a box, and a reset that appears only once
 * something has been typed.
 *
 * Five pages had their own copy of this, with their own CSS, and the copies had
 * started to drift — a different focus colour here, no reset button there.
 */
export default function SearchBar({ value, onChange, placeholder, children }: SearchBarProps) {
  const { t } = useTranslation();

  return (
    <div className={styles.bar}>
      <input
        className={styles.search}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t(placeholder)}
        aria-label={t(placeholder)}
      />
      {value.trim() && <Button onClick={() => onChange('')}>{t('common.reset')}</Button>}
      {children}
    </div>
  );
}
