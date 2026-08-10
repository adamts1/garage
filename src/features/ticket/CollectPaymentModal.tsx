import { DEFAULT_PAY_METHOD, money, PAY_METHODS, type PayMethod } from '@garage/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/Button';
import { SelectField, TextField } from '../../components/Field';
import Modal from '../../components/Modal/Modal';
import type { ModalComponentProps } from '../../components/Modal/types';
import { IconCard } from '../../icons';
import { settleModal } from '../../store/useModalResult';

/**
 * Money arriving against a חשבונית מס.
 *
 * The mirror of the credit dialog, and deliberately shaped like it — one is
 * money coming in against an open bill, the other money going back out, and an
 * advisor should not have to learn two different screens for the same shape of
 * question.
 *
 * It opens on the whole outstanding amount, because paying the bill in full is
 * what usually happens and typing a total by hand is how a digit goes missing.
 * Editing it down is a part payment, and the line at the bottom says which of
 * the two is about to happen: one of them settles the ticket and the other
 * leaves the customer owing the rest.
 *
 * Unlike a credit note there is no snapping to a reachable amount. A receipt has
 * no lines and no VAT of its own — it records a sum that arrived, and any sum
 * can arrive. The VAT was settled by the invoice.
 *
 * Resolves { amount, payMethod, reference } or null when dismissed.
 */
export interface CollectPaymentAnswer {
  amount: number;
  payMethod: PayMethod;
  reference: string;
}

export default function CollectPaymentModal({ props, isTop, stacked, onClose }: ModalComponentProps) {
  const { t } = useTranslation();

  const resultId = String(props.resultId ?? '');
  const owed = Number(props.owed ?? 0);
  const invoiceTotal = Number(props.invoiceTotal ?? owed);
  const docnum = String(props.docnum ?? '');
  const customer = String(props.customer ?? '');
  /** Set when earlier payments have already come in against this invoice. */
  const alreadyPaid = round2(invoiceTotal - owed);

  const [amount, setAmount] = useState(String(owed));
  const [payMethod, setPayMethod] = useState<PayMethod>(DEFAULT_PAY_METHOD);
  const [reference, setReference] = useState('');

  const typed = Number(String(amount).replace(',', '.'));
  const valid = Number.isFinite(typed) && typed > 0 && round2(typed) <= owed;
  const full = valid && round2(typed) >= owed;

  const answer = (value: CollectPaymentAnswer | null) => {
    settleModal(resultId, value);
    onClose();
  };

  const submit = () => {
    if (valid) answer({ amount: round2(typed), payMethod, reference: reference.trim() });
  };

  return (
    <Modal
      title="collect.title"
      size="sm"
      isTop={isTop}
      stacked={stacked}
      onClose={() => answer(null)}
      actions={
        <>
          {/* Focus starts on Cancel, as it does for issuing and crediting: Enter
              must not create a tax document by itself. */}
          <Button data-autofocus onClick={() => answer(null)}>{t('common.cancel')}</Button>
          <Button variant="primary" disabled={!valid} onClick={submit}>
            <IconCard /> {t('collect.confirm')}
          </Button>
        </>
      }
    >
      <p>{t('collect.body', { docnum, customer, total: money(invoiceTotal) })}</p>

      {alreadyPaid > 0 && (
        <p>{t('collect.alreadyPaid', { paid: money(alreadyPaid), owed: money(owed) })}</p>
      )}

      <TextField
        label="collect.amount"
        hint="collect.amountHint"
        inputMode="decimal"
        autoFocus
        value={amount}
        error={amount.trim() !== '' && !valid ? t('collect.tooMuch', { owed: money(owed) }) : undefined}
        onChange={(e) => setAmount(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
      />

      {/* A closed list, because what goes in the column is a code and free text
          has no code. The case nobody listed is `other`, and the reference
          field below it is where the detail goes. */}
      <SelectField
        label="collect.payMethod"
        value={payMethod}
        onChange={(e) => setPayMethod(e.target.value as PayMethod)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
      >
        {PAY_METHODS.map((m) => (
          <option key={m} value={m}>{t(`payMethods.${m}`)}</option>
        ))}
      </SelectField>

      <TextField
        label="collect.reference"
        hint="collect.referenceHint"
        value={reference}
        onChange={(e) => setReference(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
      />

      {/* Which of the two this is, in the words of what changes to the ticket. */}
      {valid && (
        <p>{full ? t('collect.willSettle') : t('collect.willReduce', { left: money(round2(owed - round2(typed))) })}</p>
      )}
    </Modal>
  );
}

const round2 = (n: number) => Math.round(n * 100) / 100;
