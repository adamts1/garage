import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import styles from './Modal.module.css';
import { useModal } from './useModal';

export interface ModalProps {
  /** i18n key for the heading. */
  title: string;
  titleValues?: Record<string, string | number>;
  children: ReactNode;
  /** Buttons. Rendered in a footer bar; the last one is pushed to the end. */
  actions?: ReactNode;
  onClose: () => void;
  /** False for anything under the top of the stack: it keeps its appearance but
   *  stops answering Escape and stops taking focus. */
  isTop?: boolean;
  /** Deeper than the first — draws a lighter scrim so the modal below shows. */
  stacked?: boolean;
  size?: 'sm' | 'md';
}

/** The shell every modal shares: scrim, panel, heading, footer. What goes in
 *  the body is the caller's business. */
export default function Modal({
  title,
  titleValues,
  children,
  actions,
  onClose,
  isTop = true,
  stacked = false,
  size = 'md',
}: ModalProps) {
  const { t } = useTranslation();
  const { panelRef } = useModal({ isTop, onClose });

  return (
    <div
      className={[styles.scrim, stacked ? styles.stacked : null].filter(Boolean).join(' ')}
      /* Only a click that both starts and ends on the scrim closes it. Without
         the target check, selecting text in the body and releasing outside the
         panel threw the dialog away mid-edit. */
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className={[styles.panel, size === 'sm' ? styles.sm : null].filter(Boolean).join(' ')}
        role="dialog"
        aria-modal="true"
        aria-label={t(title, titleValues)}
        tabIndex={-1}
      >
        <div className={styles.head}>
          <h3>{t(title, titleValues)}</h3>
          <button
            type="button"
            className={styles.close}
            onClick={onClose}
            aria-label={t('common.close')}
          >
            ✕
          </button>
        </div>

        <div className={styles.body}>{children}</div>

        {actions && <div className={styles.foot}>{actions}</div>}
      </div>
    </div>
  );
}
