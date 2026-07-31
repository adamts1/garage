import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../Button';
import Modal from './Modal';
import type { ModalComponentProps } from './types';
import { settleConfirm } from '../../store/useConfirm';

/** Replaces `window.confirm`. Reached through `useConfirm()`, never rendered
 *  directly — the store opens it and the promise it settles is the answer. */
export default function ConfirmModal({ props, isTop, stacked, onClose }: ModalComponentProps) {
  const { t } = useTranslation();

  const confirmId = String(props.confirmId ?? '');
  const titleKey = String(props.titleKey ?? 'confirm.title');
  const bodyKey = String(props.bodyKey ?? '');
  const danger = props.danger === true;
  const values =
    props.values && typeof props.values === 'object'
      ? (props.values as Record<string, string | number>)
      : undefined;

  /* Whatever route the dialog leaves by — the button, Escape, the scrim, a
     navigation that unmounts the host — the caller is awaiting a promise, and
     an unsettled one is a handler that never runs and a spinner that never
     stops. Answering "no" on the way out is the safe default, and settling is
     idempotent, so the explicit answers below still win. */
  const settled = useRef(false);
  useEffect(
    () => () => {
      if (!settled.current) settleConfirm(confirmId, false);
    },
    [confirmId],
  );

  const answer = (value: boolean) => {
    settled.current = true;
    settleConfirm(confirmId, value);
    onClose();
  };

  return (
    <Modal
      title={titleKey}
      size="sm"
      isTop={isTop}
      stacked={stacked}
      onClose={() => answer(false)}
      actions={
        <>
          {/* On a destructive dialog focus starts on Cancel, so the Enter key
              of someone still reading the question cannot delete anything.
              A non-destructive one focuses the action, which is what they came
              to press. */}
          <Button variant="ghost" onClick={() => answer(false)} data-autofocus={danger || undefined}>
            {t('confirm.no')}
          </Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            onClick={() => answer(true)}
            data-autofocus={!danger || undefined}
          >
            {t('confirm.yes')}
          </Button>
        </>
      }
    >
      {t(bodyKey, values)}
    </Modal>
  );
}
