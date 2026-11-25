import { useTranslation } from 'react-i18next';
import { IconSearch } from '../icons';
import styles from './SearchInput.module.css';

/** A search box with its magnifier. The placeholder (i18n key) is also its
 *  accessible name. Escape clears it. */
export function SearchInput({ value, onChange, placeholder }: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  const { t } = useTranslation();
  return (
    <label className={styles.box}>
      <IconSearch size={18} />
      <input
        type="search"
        value={value}
        placeholder={t(placeholder)}
        aria-label={t(placeholder)}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Escape') onChange(''); }}
      />
    </label>
  );
}
