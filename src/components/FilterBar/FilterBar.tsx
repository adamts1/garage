import type { ReactNode } from 'react';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import styles from './FilterBar.module.css';

export function FilterBar({ children }: { children: ReactNode }) {
  return <div className={styles.bar}>{children}</div>;
}

export interface FilterProps {
  /** i18n key. Labels here are above the control too — the same rule as Field,
   *  and these already followed it. */
  label: string;
  children: (id: string) => ReactNode;
}

export function Filter({ label, children }: FilterProps) {
  const { t } = useTranslation();
  const id = useId();

  return (
    <label className={styles.filter} htmlFor={id}>
      <span>{t(label)}</span>
      {children(id)}
    </label>
  );
}

export interface ClearFiltersProps {
  onClick: () => void;
  /** Rendered only when something is actually filtered — a permanently visible
   *  "clear" on an unfiltered view is a button that does nothing. */
  show: boolean;
}

export function ClearFilters({ onClick, show }: ClearFiltersProps) {
  const { t } = useTranslation();
  if (!show) return null;
  return (
    <button type="button" className={styles.clear} onClick={onClick}>
      ✕ {t('common.clearFilters')}
    </button>
  );
}
