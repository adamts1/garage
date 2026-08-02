import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { settleModal } from '../../store/useModalResult';
import { Button } from '../Button';
import { TextField } from '../Field';
import Modal from '../Modal/Modal';
import type { ModalComponentProps } from '../Modal/types';

/**
 * Replaces `window.prompt` — the last native dialog in the app, and the same
 * problem as `window.confirm`: it blocks the main thread, cannot be styled or
 * translated, and some browsers suppress it outright.
 *
 * Resolves the typed string, or null when dismissed. An empty box still
 * resolves `''`, which is a different answer from "cancelled" and callers rely
 * on the distinction.
 */
export default function PromptModal({ props, isTop, stacked, onClose }: ModalComponentProps) {
  const { t } = useTranslation();

  const resultId = String(props.resultId ?? '');
  const titleKey = String(props.titleKey ?? 'prompt.title');
  const labelKey = String(props.labelKey ?? 'prompt.label');
  const [value, setValue] = useState(String(props.defaultValue ?? ''));

  const answer = (result: string | null) => {
    settleModal(resultId, result);
    onClose();
  };

  return (
    <Modal
      title={titleKey}
      size="sm"
      isTop={isTop}
      stacked={stacked}
      onClose={() => answer(null)}
      actions={
        <>
          <Button onClick={() => answer(null)}>{t('common.cancel')}</Button>
          <Button variant="primary" data-autofocus onClick={() => answer(value)}>
            {t('common.confirm')}
          </Button>
        </>
      }
    >
      <TextField
        label={labelKey}
        value={value}
        autoFocus
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); answer(value); } }}
      />
    </Modal>
  );
}
