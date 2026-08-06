import { issuableCredit, money } from '@garage/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/Button';
import { TextField } from '../../components/Field';
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
 * Resolves { amount, reason } or null when dismissed.
 */
export interface CreditNoteAnswer {
  amount: number;
  reason: string;
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

  const [amount, setAmount] = useState(String(remaining));
  const [reason, setReason] = useState('');

  const typed = Number(String(amount).replace(',', '.'));
  const valid = Number.isFinite(typed) && typed > 0 && round2(typed) <= remaining;
  const full = valid && round2(typed) >= remaining;

  /* Not every amount can be put on a document: lines are priced before VAT and
     the provider adds it, so the reachable grosses have gaps — ₪100.00 is one of
     them. The server snaps to the nearest reachable one either way; showing it
     here is what keeps the advisor from promising a figure the document will not
     carry. Undefined when the typed amount is reachable, which is most of them. */
  const issuable = valid ? issuableCredit(round2(typed), vatRate, remaining) : null;
  const adjusted = issuable && issuable.total !== round2(typed) ? issuable.total : null;
  /* What is actually about to be handed back — every figure below is derived
     from this rather than from what was typed. */
  const credited = issuable?.total ?? round2(typed);

  const answer = (value: CreditNoteAnswer | null) => {
    settleModal(resultId, value);
    onClose();
  };

  const submit = () => {
    /* The snapped figure, not the typed one, so the amount confirmed on screen
       is the amount sent. The server snaps again — it does not trust this — and
       snapping a reachable amount returns it unchanged. */
    if (valid) answer({ amount: credited, reason: reason.trim() });
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
            <IconDoc /> {t('credit.confirm')}
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

      {/* The typed amount cannot be put on a document, so this is what will be.
          Said before the button, not in a toast afterwards. */}
      {adjusted !== null && <p>{t('credit.adjusted', { amount: money(adjusted) })}</p>}

      {/* What the button is about to do, in the words of what changes: one of
          these leaves a live invoice behind and the other does not. */}
      {valid && <p>{full ? t('credit.willVoid') : t('credit.willReduce', { left: money(round2(remaining - credited)) })}</p>}
    </Modal>
  );
}

const round2 = (n: number) => Math.round(n * 100) / 100;
