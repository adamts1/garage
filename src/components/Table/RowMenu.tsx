import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import styles from './RowMenu.module.css';

export interface RowMenuItem {
  /** i18n key. */
  label: string;
  onSelect: () => void;
  danger?: boolean;
  /** Left out of the menu rather than shown disabled. */
  hidden?: boolean;
}

/** The "⋯" at the end of a row: its actions in a short list, so a row carries
 *  one button rather than four.
 *
 *  The list is portalled to <body> and placed by the button's position. Inside
 *  the table it would be clipped by the table's own scroll box on the last
 *  rows, which is where a menu opens most. */
export function RowMenu({ items, label = 'common.actions' }: { items: RowMenuItem[]; label?: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const shown = items.filter((i) => !i.hidden);

  /* Under the button, its start edge on the button's start edge (the right,
     in Hebrew); flipped above when there is no room below. */
  useLayoutEffect(() => {
    if (!open) return;
    const b = buttonRef.current?.getBoundingClientRect();
    const list = listRef.current;
    if (!b || !list) return;
    const h = list.offsetHeight;
    const w = list.offsetWidth;
    const below = b.bottom + 6 + h <= window.innerHeight;
    setPos({
      top: below ? b.bottom + 6 : Math.max(8, b.top - 6 - h),
      left: Math.max(8, Math.min(b.left, window.innerWidth - w - 8)),
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!listRef.current?.contains(target) && !buttonRef.current?.contains(target)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { close(); buttonRef.current?.focus(); }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  if (shown.length === 0) return null;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={styles.trigger}
        aria-label={t(label)}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => { setPos(null); setOpen((v) => !v); }}
      >
        ⋯
      </button>
      {open && createPortal(
        <div
          ref={listRef}
          role="menu"
          className={styles.menu}
          style={pos ? { top: pos.top, left: pos.left } : { visibility: 'hidden', top: 0, left: 0 }}
        >
          {shown.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className={item.danger ? `${styles.item} ${styles.danger}` : styles.item}
              onClick={() => { setOpen(false); item.onSelect(); }}
            >
              {t(item.label)}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}
