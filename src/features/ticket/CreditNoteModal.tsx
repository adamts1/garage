import { money } from '@garage/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/Button';
import { CheckboxField, TextField } from '../../components/Field';
import Modal from '../../components/Modal/Modal';
import type { ModalComponentProps } from '../../components/Modal/types';
import { IconDoc } from '../../icons';
import { settleModal } from '../../store/useModalResult';

/**
 * Giving a customer money back.
 *
 * Two fields rather than the generic prompt's one, and the second is not
 * decoration: a credit note carries its reason onto the document the customer
 * receives, and "why is there ₪300 less here" is the question it exists to
 * answer.
 *
 * The amount is what the CUSTOMER gets — VAT included, the figure printed on
 * the invoice in their hand. Anything else invites an advisor to type the
 * pre-VAT number off a screen and hand back 18% too little.
 *
 * It opens with the whole remaining amount filled in, because crediting all of
 * it is the common case (a job cancelled, a car returned) and typing the total
 * by hand is how a digit gets dropped. Editing it down is a partial credit, and
 * the dialog says which of the two is about to happen — a full credit voids the
 * invoice, a partial one leaves it standing.
 *
 * When the bill was paid by a card the clearing provider charged, it also
 * offers to return the money to that card — ticked, since a customer credited
 * for a card payment is usually refunded to the card. Up to what the card can
 * still take back; anything above that is returned some other way, and the
 * dialog says how much.
 *
 * Resolves { amount, reason, refundToCard } or null when dismissed.
 */
export interface CreditNoteAnswer {
  amount: number;
  reason: string;
  refundToCard: boolean;
}

export default function CreditNoteModal({ props, isTop, stacked, onClose }: ModalComponentProps) {
  const { t } = useTranslation();

  const resultId = String(props.resultId ?? '');
  const remaining = Number(props.remaining ?? 0);
  const invoiceTotal = Number(props.invoiceTotal ?? remaining);
  const docnum = String(props.docnum ?? '');
  const customer = String(props.customer ?? '');
  /** Set when earlier credits have already come off this invoice. */
  const alreadyCredited = round2(invoiceTotal - remaining);

  const vatRate = Number(props.vatRate ?? 0);

  /** What the card that paid this bill can still take back — 0 when it was
   *  not paid by a card the provider charged. */
  const cardLeft = Number(props.cardRefundable ?? 0);
  const cardLast4 = props.cardLast4 ? String(props.cardLast4) : '';
  /** A refund on that card has no clear answer yet: none can start. */
  const cardUnresolved = props.cardUnresolved === true;
  const [toCard, setToCard] = useState(cardLeft > 0 && !cardUnresolved);

  const [amount, setAmount] = useState(String(remaining));
  const [reason, setReason] = useState('');

  const typed = Number(String(amount).replace(',', '.'));
  const valid = Number.isFinite(typed) && typed > 0 && round2(typed) <= remaining;
  const full = valid && round2(typed) >= remaining;

  /* What is handed back is exactly what was typed: the credit line is sent
     VAT-inclusive and the provider takes the VAT out of it, so every sum to
     the agora can be issued (it used to snap — ₪10 became ₪9.99). */
  const credited = round2(typed);
  void vatRate; // the document's rate: the server prices the line with it

  const answer = (value: CreditNoteAnswer | null) => {
    settleModal(resultId, value);
    onClose();
  };

  const submit = () => {
    if (valid) answer({ amount: credited, reason: reason.trim(), refundToCard: toCard && cardLeft > 0 });
  };

  return (
    <Modal
      title="credit.title"
      size="sm"
      isTop={isTop}
      stacked={stacked}
      onClose={() => answer(null)}
      actions={
        <>
          {/* Focus starts on Cancel, as it does for issuing: Enter must not
              hand a customer money by itself. */}
          <Button data-autofocus onClick={() => answer(null)}>{t('common.cancel')}</Button>
          <Button variant="primary" disabled={!valid} onClick={submit}>
            <IconDoc /> {t(toCard && cardLeft > 0 ? 'credit.confirmRefund' : 'credit.confirm')}
          </Button>
        </>
      }
    >
      <p>{t('credit.body', { docnum, customer, total: money(invoiceTotal) })}</p>

      {alreadyCredited > 0 && (
        <p>{t('credit.alreadyCredited', { credited: money(alreadyCredited), remaining: money(remaining) })}</p>
      )}

      <TextField
        label="credit.amount"
        hint="credit.amountHint"
        inputMode="decimal"
        autoFocus
        value={amount}
        error={amount.trim() !== '' && !valid ? t('credit.tooMuch', { remaining: money(remaining) }) : undefined}
        onChange={(e) => setAmount(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
      />

      <TextField
        label="credit.reason"
        hint="credit.reasonHint"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
      />

      {/* Money back to the card, before the document. */}
      {cardLeft > 0 && (
        <>
          <CheckboxField
            label="credit.toCard"
            labelValues={{ last4: cardLast4 ? `****${cardLast4}` : '' }}
            checked={toCard}
            disabled={cardUnresolved}
            onChange={(e) => setToCard(e.target.checked)}
          />
          {cardUnresolved && <p>{t('credit.cardUnresolved')}</p>}
          {toCard && valid && (
            <p>
              {t('credit.willRefund', { amount: money(Math.min(credited, cardLeft)) })}
              {credited > cardLeft && ` ${t('credit.restOtherwise', { rest: money(round2(credited - cardLeft)) })}`}
            </p>
          )}
        </>
      )}


      {/* What the button is about to do, in the words of what changes: one of
          these leaves a live invoice behind and the other does not. */}
      {valid && <p>{full ? t('credit.willVoid') : t('credit.willReduce', { left: money(round2(remaining - credited)) })}</p>}
    </Modal>
  );
}

const round2 = (n: number) => Math.round(n * 100) / 100;
