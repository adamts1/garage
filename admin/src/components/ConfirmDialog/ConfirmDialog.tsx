import { useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { EnvId } from '../../api/types';
import { Button, Modal, TextField } from '../app';
import { Note } from '../Section/Section';

export interface ConfirmDialogProps {
  /** i18n key. */
  title: string;
  titleValues?: Record<string, string | number>;
  env: EnvId;
  children: ReactNode;
  /** i18n key for the confirm button. */
  confirmLabel: string;
  confirmValues?: Record<string, string | number>;
  danger?: boolean;
  /** Opened over another dialog (the garage drawer): a lighter scrim. */
  stacked?: boolean;
  /** Throws to show its message in the dialog and keep it open. */
  onConfirm: (confirmEnv: string) => Promise<void>;
  onClose: () => void;
}

/** "Are you sure", for every write the console makes. On production the
 *  environment's name has to be typed — the server checks the same word
 *  again, so this is for the person, not the guard. */
export function ConfirmDialog({
  title, titleValues, env, children, confirmLabel, confirmValues, danger, stacked, onConfirm, onClose,
}: ConfirmDialogProps) {
  const { t } = useTranslation();
  const [typed, setTyped] = useState('');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const needsTyping = env === 'production';
  const ready = !needsTyping || typed.trim() === 'production';

  const confirm = async () => {
    setWorking(true);
    setError(null);
    try {
      await onConfirm(typed.trim());
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setWorking(false);
    }
  };

  /* Portalled to <body>, so it is not laid out inside a table cell. React
     still bubbles its events up the component tree — to a clickable row,
     say — which the wrapper stops. */
  return createPortal(
    <div onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
    <Modal
      title={title}
      titleValues={titleValues}
      size="sm"
      stacked={stacked}
      onClose={() => { if (!working) onClose(); }}
      actions={
        <>
          <Button variant="ghost" onClick={onClose} disabled={working}>{t('console.common.cancel')}</Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={() => void confirm()} disabled={!ready || working}>
            {working ? t('console.common.working') : t(confirmLabel, confirmValues)}
          </Button>
        </>
      }
    >
      {children}
      {needsTyping && (
        <TextField
          label="console.common.typeProduction"
          dir="ltr"
          autoComplete="off"
          data-autofocus
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && ready && !working) void confirm(); }}
        />
      )}
      {error && <Note tone="danger">{t('console.common.error', { message: error })}</Note>}
    </Modal>
    </div>,
    document.body,
  );
}
