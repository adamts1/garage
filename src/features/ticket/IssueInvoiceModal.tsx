import { useTranslation } from 'react-i18next';
import { Button } from '../../components/Button';
import Modal from '../../components/Modal/Modal';
import type { ModalComponentProps } from '../../components/Modal/types';
import { IconDoc } from '../../icons';
import { settleModal } from '../../store/useModalResult';

/**
 * The guard in front of issuing a tax document, kept as its own dialog rather
 * than folded into the generic confirm.
 *
 * It earns that: the copy names the amount and the customer, and says plainly
 * that the document cannot be deleted — only cancelled by a credit note, which
 * is itself a real document. A generic "are you sure?" with an "OK" button
 * would be a worse guard on the most irreversible action in the app.
 */
export default function IssueInvoiceModal({ props, isTop, stacked, onClose }: ModalComponentProps) {
  const { t } = useTranslation();

  const resultId = String(props.resultId ?? '');
  const amount = String(props.amount ?? '');
  const customer = String(props.customer ?? '');
  /* Which bill is about to exist. The copy differs in the one way that matters:
     a מס-קבלה says money changed hands, a חשבונית מס says it has not yet. */
  const docType = props.docType === 'tax_invoice' ? 'tax_invoice' : 'invoice_receipt';

  const answer = (value: boolean) => {
    settleModal(resultId, value);
    onClose();
  };

  return (
    <Modal
      title={`invoiceIssue.title_${docType}`}
      size="sm"
      isTop={isTop}
      stacked={stacked}
      onClose={() => answer(false)}
      actions={
        <>
          {/* Focus starts on Cancel: this is the one dialog where a stray Enter
              would create a legal document. */}
          <Button data-autofocus onClick={() => answer(false)}>{t('common.cancel')}</Button>
          <Button variant="primary" onClick={() => answer(true)}>
            <IconDoc /> {t('invoiceIssue.confirm')}
          </Button>
        </>
      }
    >
      <p>{t(`invoiceIssue.body_${docType}`, { amount, customer })}</p>
      <p>{t('invoiceIssue.warning')}</p>
    </Modal>
  );
}
