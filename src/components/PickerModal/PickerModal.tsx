import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../Button';
import Modal from '../Modal/Modal';
import styles from './PickerModal.module.css';

export interface PickerModalProps<T> {
  /** i18n key for the heading. */
  title: string;
  /** i18n key for the search box placeholder. */
  searchPlaceholder: string;
  items: readonly T[];
  itemKey: (item: T) => string;
  /** Whether an item survives the typed query. */
  match: (item: T, query: string) => boolean;
  renderRow: (item: T) => ReactNode;
  /** i18n key, given `{{query}}` — "no work called X". */
  emptyKey: string;
  /** i18n key for the create button. */
  createLabel: string;
  initialQuery?: string;
  onPick: (item: T) => void;
  /** Called with whatever was typed, so the create form can start from it. */
  onCreate: (typed: string) => void;
  onClose: () => void;
  isTop?: boolean;
  stacked?: boolean;
}

/**
 * The search half of a picker: type, arrow through the results, Enter to take
 * one — or, when nothing matches, Enter to create.
 *
 * Works and parts had a copy of this each, identical down to the keyboard
 * handling and drifting only in their strings.
 */
export default function PickerModal<T>({
  title, searchPlaceholder, items, itemKey, match, renderRow, emptyKey, createLabel,
  initialQuery = '', onPick, onCreate, onClose, isTop = true, stacked = false,
}: PickerModalProps<T>) {
  const { t } = useTranslation();
  const [query, setQuery] = useState(initialQuery);
  const [cursor, setCursor] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => { searchRef.current?.focus(); }, []);

  const results = useMemo(
    () => (query.trim() ? items.filter((i) => match(i, query)) : [...items]),
    [items, query, match],
  );

  /* The highlighted row is an index into a list that shrinks as you type. Left
     alone it points past the end and Enter takes nothing. */
  const active = Math.min(cursor, Math.max(results.length - 1, 0));

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { onClose(); return; }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, results.length - 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
      return;
    }
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (results.length > 0) onPick(results[active]);
    else onCreate(query.trim());
  };

  return (
    <Modal
      title={title}
      onClose={onClose}
      isTop={isTop}
      stacked={stacked}
      actions={
        <>
          <span className={styles.hint}>{t('picker.keys')}</span>
          <Button variant="primary" onClick={() => onCreate(query.trim())}>
            ＋ {t(createLabel)}
          </Button>
        </>
      }
    >
      <input
        ref={searchRef}
        className={styles.search}
        placeholder={t(searchPlaceholder)}
        aria-label={t(searchPlaceholder)}
        value={query}
        onChange={(e) => { setQuery(e.target.value); setCursor(0); }}
        onKeyDown={onKeyDown}
      />

      <div className={styles.list}>
        {results.map((item, i) => (
          <button
            type="button"
            key={itemKey(item)}
            className={`${styles.row}${i === active ? ` ${styles.on}` : ''}`}
            onMouseEnter={() => setCursor(i)}
            onClick={() => onPick(item)}
          >
            {renderRow(item)}
          </button>
        ))}

        {results.length === 0 && (
          <div className={styles.empty}>
            <div>{t(emptyKey, { query: query.trim() })}</div>
            <div className={styles.muted}>{t('picker.enterToCreate')}</div>
          </div>
        )}
      </div>
    </Modal>
  );
}
