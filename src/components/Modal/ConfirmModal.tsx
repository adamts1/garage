import { useTranslation } from 'react-i18next';
import { Button } from '../Button';
import Modal from './Modal';
import type { ModalComponentProps } from './types';
import { settleModal } from '../../store/useModalResult';

/** Replaces `window.confirm`. Reached through `useConfirm()`, never rendered
 *  directly — the store opens it and the promise it settles is the answer. */
export default function ConfirmModal({ props, isTop, stacked, onClose }: ModalComponentProps) {
  const { t } = useTranslation();

  const resultId = String(props.resultId ?? '');
  const titleKey = String(props.titleKey ?? 'confirm.title');
  const bodyKey = String(props.bodyKey ?? '');
  const danger = props.danger === true;
  const values =
    props.values && typeof props.values === 'object'
      ? (props.values as Record<string, string | number>)
      : undefined;

  /* Only the two buttons settle from here. Dismissal by Escape, the scrim or a
     cleared stack is answered by useConfirm, which watches the store — this
     component used to do it on unmount, and StrictMode's effect replay then
     answered "no" the instant the dialog appeared. See useConfirm. */
  const answer = (value: boolean) => {
    settleModal(resultId, value);
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
