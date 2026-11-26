import { money } from '@garage/shared';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/Button';
import type { ModalComponentProps } from '../../components/Modal/types';
import { IconCheck } from '../../icons';
import { settleModal } from '../../store/useModalResult';
import styles from './CloseTicketModal/CloseTicketModal.module.css';

/**
 * Money went back to a card: the confirmation, in the same drawer and the same
 * success moment as taking a card payment — so "charged" and "returned" read as
 * two halves of one thing.
 *
 * Every figure on it is the provider's answer as issue-invoice stored it, and
 * the same facts are printed on the credit note (its remark): the advisor can
 * read the approval out to the customer, and the customer finds it again on the
 * document.
 *
 * Stays until closed — unlike the payment's success screen it does not hand an
 * answer on, so there is nothing to hurry it for.
 */
export default function RefundDoneModal({ props, onClose }: ModalComponentProps) {
  const { t } = useTranslation();
  const resultId = String(props.resultId ?? '');
  const cancel = props.kind === 'cancel';
  const amount = Number(props.amount ?? 0);
  const last4 = props.cardLast4 ? String(props.cardLast4) : '';
  const brand = props.cardBrand ? String(props.cardBrand) : '';
  const approval = props.approvalNumber ? String(props.approvalNumber) : '';
  const refundId = props.providerRefundId ? String(props.providerRefundId) : '';
  const originalRef = props.originalRef ? String(props.originalRef) : '';
  const docnum = props.docnum ? String(props.docnum) : '';
  const noteTotal = Number(props.noteTotal ?? amount);

  const close = () => {
    settleModal(resultId, true);
    onClose();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={styles.scrim} onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <aside className={styles.drawer} role="dialog" aria-modal="true" aria-label={t('refundDone.title')}>
        <div className={styles.success}>
          <div className={styles.burst}>
            <span className={styles.ring} />
            <span className={styles.tick}><IconCheck /></span>
          </div>
          <h3>{t(cancel ? 'refundDone.titleCancel' : 'refundDone.title')}</h3>
          <p className={styles.amount}>{money(amount)}</p>
          <p className={styles.docLine}>
            {t(cancel ? 'refundDone.lineCancel' : 'refundDone.line')}
            {docnum && ` · ${t('refundDone.noteIssued', { docnum, total: money(noteTotal) })}`}
          </p>
          {/* A visit paid partly in cash and credited in full: only the card's
              share can go back to the card. The rest is the advisor's to hand
              over, and the screen that celebrates the refund must say so. */}
          {noteTotal - amount > 0.005 && (
            <p className={styles.docLine} role="alert">
              {t('refundDone.restOtherwise', { amount: money(amount), rest: money(Math.round((noteTotal - amount) * 100) / 100) })}
            </p>
          )}

          <dl className={`kv ${styles.approval}`}>
            <dt>{t('refundDone.kind')}</dt>
            <dd>{t(cancel ? 'refundDone.kindCancel' : 'refundDone.kindRefund')}</dd>
            {(brand || last4) && (
              <><dt>{t('close.card')}</dt><dd>{[brand, last4 ? `****${last4}` : null].filter(Boolean).join(' · ')}</dd></>
            )}
            {approval && (
              <><dt>{t('close.methods.cardApproval')}</dt><dd><b>{approval}</b></dd></>
            )}
            {refundId && (<><dt>{t('refundDone.reference')}</dt><dd>{refundId}</dd></>)}
            {originalRef && (<><dt>{t('refundDone.original')}</dt><dd>{originalRef}</dd></>)}
            {docnum && (<><dt>{t('refundDone.creditNote')}</dt><dd>#{docnum}</dd></>)}
          </dl>

          <Button variant="primary" onClick={close}>{t('common.close')}</Button>
        </div>
      </aside>
    </div>
  );
}
