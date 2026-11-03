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
  /** Rows already ticked when the picker opens — the ones carried through a
   *  detour into the create form and back. */
  initialPicked?: readonly T[];
  /** Everything chosen, in the order it was ticked. Never empty. */
  onPick: (items: T[]) => void;
  /** Called with whatever was typed, so the create form can start from it, and
   *  with what is ticked so far, so the new one can join them rather than
   *  replace them. */
  onCreate: (typed: string, picked: T[]) => void;
  onClose: () => void;
  isTop?: boolean;
  stacked?: boolean;
}

/**
 * The search half of a picker: type, arrow through the results, Enter to take
 * one — or, when nothing matches, Enter to create.
 *
 * Several at once, too: a click ticks a row instead of taking it, and the
 * ticked rows go in together — a brake job is pads, discs and fluid, and the
 * picker used to be opened three times for it. The phone's pickers have always
 * worked this way. Enter with nothing ticked still takes the highlighted row
 * outright, so the keyboard path for a single line is unchanged.
 *
 * Works and parts had a copy of this each, identical down to the keyboard
 * handling and drifting only in their strings.
 */
export default function PickerModal<T>({
  title, searchPlaceholder, items, itemKey, match, renderRow, emptyKey, createLabel,
  initialQuery = '', initialPicked = [], onPick, onCreate, onClose, isTop = true, stacked = false,
}: PickerModalProps<T>) {
  const { t } = useTranslation();
  const [query, setQuery] = useState(initialQuery);
  /* By key, and holding the item itself: a ticked row filtered out by the next
     search is still ticked. */
  const [picked, setPicked] = useState<T[]>(() => [...initialPicked]);
  const isPicked = (item: T) => picked.some((p) => itemKey(p) === itemKey(item));
  const toggle = (item: T) =>
    setPicked((prev) =>
      prev.some((p) => itemKey(p) === itemKey(item))
        ? prev.filter((p) => itemKey(p) !== itemKey(item))
        : [...prev, item],
    );
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
    /* Nothing matches: the screen says "Enter to create", so it creates — with
       whatever is ticked carried along, not dropped. */
    if (results.length === 0) onCreate(query.trim(), picked);
    else if (picked.length > 0) onPick(picked);
    else onPick([results[active]]);
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
          <Button onClick={() => onCreate(query.trim(), picked)}>
             {t(createLabel)} ＋
          </Button>
          <Button variant="primary" disabled={picked.length === 0} onClick={() => onPick(picked)}>
            {t('picker.addPicked', { count: picked.length })}
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
        {results.map((item, i) => {
          const on = isPicked(item);
          return (
            <button
              type="button"
              key={itemKey(item)}
              role="checkbox"
              aria-checked={on}
              className={`${styles.row}${i === active ? ` ${styles.on}` : ''}${on ? ` ${styles.picked}` : ''}`}
              onMouseEnter={() => setCursor(i)}
              onClick={() => toggle(item)}
            >
              <span className={styles.check} aria-hidden>{on ? '✓' : ''}</span>
              {renderRow(item)}
            </button>
          );
        })}

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
