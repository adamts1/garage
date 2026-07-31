import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppDispatch } from '../../store';
import { toastDismissed, type Toast as ToastModel } from '../../store/toastSlice';
import styles from './Toast.module.css';
import { useToastTimer } from './useToastTimer';

const ICON: Record<ToastModel['kind'], string> = {
  success: '✓',
  error: '!',
  info: 'i',
};

export interface ToastProps {
  toast: ToastModel;
}

export default function Toast({ toast }: ToastProps) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();

  /* Hovering holds the toast open. A long Supabase error that times out while
     you are still reading it is the one you most needed to read. */
  const [paused, setPaused] = useState(false);
  useToastTimer(toast, paused);

  // `key` wins when both are set; `text` is the escape hatch for messages that
  // originate outside the app and have no key.
  const message = toast.key ? t(toast.key, toast.values) : (toast.text ?? '');

  return (
    <div
      className={`${styles.toast} ${styles[toast.kind]}`}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      /* Errors interrupt a screen reader; confirmations wait their turn. */
      role={toast.kind === 'error' ? 'alert' : 'status'}
      aria-live={toast.kind === 'error' ? 'assertive' : 'polite'}
    >
      <span className={styles.icon} aria-hidden="true">
        {ICON[toast.kind]}
      </span>
      <span className={styles.message}>{message}</span>
      <button
        type="button"
        className={styles.close}
        onClick={() => dispatch(toastDismissed(toast.id))}
        aria-label={t('toast.dismiss')}
      >
        ✕
      </button>
    </div>
  );
}
