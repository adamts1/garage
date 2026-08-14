import { money, type PayMethod } from '@garage/shared';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../../components/Button';
import { TextField } from '../../../components/Field';
import type { ModalComponentProps } from '../../../components/Modal/types';
import { IconCard, IconCheck } from '../../../icons';
import { settleModal } from '../../../store/useModalResult';
import styles from './CloseTicketModal.module.css';

/* One drawer, two jobs — ending a job and taking money for one already billed.
   They were two screens: this, and a small CollectPaymentModal built like the
   credit dialog. Both asked the same three things (how much, by what means,
   against what reference) and only one of them was reachable from a button
   whose label promised the other, so the advisor met whichever screen the code
   picked. Collecting is not a different question from being paid at the
   counter; it is the same question about money that was billed earlier. */
export type CloseMode = 'close' | 'collect';

export interface CloseResult {
  paid: boolean;
  /** A code, written into `tickets.pay_method`. Null for the open charge, which
   *  is the absence of a payment rather than one of its kinds — this drawer
   *  used to store the words "חיוב פתוח" in the column that answers "how were
   *  we paid", on a ticket nobody had paid. */
  method: PayMethod | null;
  doc: string;
  reference?: string;
  /** What is actually being collected. Equal to the total when closing, and in
   *  collect mode whatever was typed — a part payment is a smaller number, and
   *  the caller needs the figure rather than having to infer it. */
  amount: number;
}

interface Method {
  /** What gets stored. Null for the open charge; see CloseResult.method. */
  code: PayMethod | null;
  /** Identifies the card on screen — the code, except for the one without one. */
  id: string;
  /** i18n key. Shared with every other screen that names a method: the label a
   *  code carries is one decision, not one per dialog. */
  label: string;
  icon: string;
  /** i18n key for the one-line explanation. Drawer-specific, so it stays here. */
  hint: string;
  /** i18n key for what the reference field asks for, if anything. */
  ref?: string;
  paid: boolean;
}

const METHODS: Method[] = [
  { code: 'cash', id: 'cash', label: 'payMethods.cash', icon: '💵', hint: 'close.methods.cashHint', paid: true },
  { code: 'card', id: 'card', label: 'payMethods.card', icon: '💳', hint: 'close.methods.cardHint', ref: 'close.methods.cardRef', paid: true },
  { code: 'bit', id: 'bit', label: 'payMethods.bit', icon: '📱', hint: 'close.methods.bitHint', ref: 'close.methods.reference', paid: true },
  { code: 'bank_transfer', id: 'bank_transfer', label: 'payMethods.bank_transfer', icon: '🏦', hint: 'close.methods.transferHint', ref: 'close.methods.reference', paid: true },
  { code: 'cheque', id: 'cheque', label: 'payMethods.cheque', icon: '🧾', hint: 'close.methods.checkHint', ref: 'close.methods.checkRef', paid: true },
  { code: null, id: 'open', label: 'close.methods.open', icon: '🕓', hint: 'close.methods.openHint', paid: false },
];

const STEP_KEYS = ['close.steps.method', 'close.steps.collect', 'close.steps.summary'];

/** Stand-in for the terminal / provider round-trip. */
const CHARGE_MS = 900;
/** How long the success screen shows before the drawer hands its answer back. */
const SUCCESS_MS = 1500;

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Reached through `useCloseTicket()` / `useCollectPayment()`. Resolves the
 *  result, or null if dismissed. */
export default function CloseTicketModal({ props, onClose }: ModalComponentProps) {
  const { t } = useTranslation();

  const resultId = String(props.resultId ?? '');
  const ticketNumber = String(props.ticketNumber ?? '');
  const customer = String(props.customer ?? '');
  const car = String(props.car ?? '');
  const plate = String(props.plate ?? '');
  const total = Number(props.total ?? 0);
  const collecting = props.mode === 'collect';
  /** The document being settled, shown while collecting so the advisor can see
   *  which bill the money is going against. */
  const docnum = String(props.docnum ?? '');

  const [step, setStep] = useState(1);
  const [methodId, setMethodId] = useState<string | null>(null);
  const [reference, setReference] = useState('');
  const [state, setState] = useState<'form' | 'charging' | 'done'>('form');
  /* Opens on the whole outstanding amount, because paying a bill in full is what
     usually happens and typing a total by hand is how a digit goes missing. */
  const [amountText, setAmountText] = useState(String(total));

  /* Collecting never offers the open charge: the bill has already been issued,
     and "pay later" is the state the ticket is already in. */
  const methods = collecting ? METHODS.filter((m) => m.paid) : METHODS;
  const method = methods.find((m) => m.id === methodId) ?? null;

  const typed = Number(String(amountText).replace(',', '.'));
  const amountValid = Number.isFinite(typed) && typed > 0 && round2(typed) <= total;
  /* Only the collect flow lets the figure be edited. Closing bills the ticket's
     own works, and a total typed over them would be a document that disagrees
     with the job behind it. */
  const amount = collecting ? round2(typed) : total;
  const full = !collecting || (amountValid && amount >= total);

  const doc = t(collecting
    ? 'close.docCollect'
    : method?.paid ? 'close.docReceipt' : 'close.docInvoice');

  const answer = (result: CloseResult | null) => {
    settleModal(resultId, result);
    onClose();
  };

  /* Held in a ref so the timer below is started by the state reaching 'done'
     and by nothing else. Naming a fresh closure as a dependency restarted it on
     every render, and a ticket could sit on the success screen without ever
     confirming. */
  const answerRef = useRef(answer);
  answerRef.current = answer;

  useEffect(() => {
    if (state !== 'done' || !method) return;
    const timer = setTimeout(() => {
      answerRef.current({
        paid: method.paid,
        method: method.code,
        doc,
        reference: reference || undefined,
        amount,
      });
    }, SUCCESS_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, method]);

  const charge = () => {
    setState('charging');
    setTimeout(() => setState('done'), CHARGE_MS);
  };

  const next = () => (step < 3 ? setStep(step + 1) : charge());

  /* What blocks "המשך" on each step: no method chosen, or — collecting — an
     amount that is not a sum of money this invoice can still take. */
  const blocked = (step === 1 && !method)
    || (step === 2 && collecting && !amountValid)
    || state === 'charging';

  if (state === 'done' && method) {
    return (
      <div className={styles.scrim}>
        <aside className={styles.drawer}>
          <div className={styles.success}>
            <div className={styles.burst}>
              <span className={styles.ring} />
              <span className={styles.tick}><IconCheck /></span>
            </div>
            <h3>
              {t(collecting
                ? 'close.successCollected'
                : method.paid ? 'close.successPaid' : 'close.successClosed')}
            </h3>
            <p className={styles.amount}>{money(amount)}</p>
            <p className={styles.docLine}>
              {collecting
                ? t('close.collectedWith', { method: t(method.label) })
                : method.paid
                  ? t('close.paidWith', { method: t(method.label) })
                  : t('close.openBalance')}
              {' · '}
              {t('close.issued', { doc })}
            </p>
          </div>
        </aside>
      </div>
    );
  }

  return (
    <div
      className={styles.scrim}
      onMouseDown={(e) => { if (e.target === e.currentTarget) answer(null); }}
    >
      <aside className={styles.drawer} role="dialog" aria-modal="true">
        <header className={styles.head}>
          <button
            type="button"
            className={styles.close}
            onClick={() => answer(null)}
            aria-label={t('common.close')}
          >
            ✕
          </button>
          <h3>{t(collecting ? 'close.collectTitle' : 'close.title')}</h3>
        </header>

        <ol
          className={styles.steps}
          style={{ '--p': (step - 1) / (STEP_KEYS.length - 1) } as React.CSSProperties}
        >
          {STEP_KEYS.map((key, i) => {
            const n = i + 1;
            return (
              <li key={key} className={n === step ? styles.on : n < step ? styles.done : undefined}>
                <span className={styles.stepDot}>{n < step ? '✓' : n}</span>
                <span className={styles.stepLabel}>{t(key)}</span>
              </li>
            );
          })}
        </ol>

        <div className={styles.body}>
          {/* ---------- 1. which payment method ---------- */}
          {step === 1 && (
            <>
              <div className={`${styles.card} ${styles.summary}`}>
                <div>
                  <span className={styles.key}>{t('close.ticketNumber')}</span>
                  <b>#{ticketNumber}</b>
                  <span className={styles.key}>{t('close.customer')}</span>
                  <b>{customer}</b>
                </div>
                <div className={styles.total}>
                  <span className={styles.key}>{t(collecting ? 'close.amountOwed' : 'close.amountDue')}</span>
                  <b>{money(total)}</b>
                </div>
              </div>

              <div className={styles.card}>
                <h4>{t(collecting ? 'close.howCollecting' : 'close.howPaying')}</h4>
                <p className={styles.hint}>{t('close.pickMethod')}</p>

                <div className={styles.payGrid}>
                  {methods.map((m) => (
                    <button
                      type="button"
                      key={m.id}
                      className={[
                        styles.payCard,
                        methodId === m.id ? styles.on : null,
                        m.paid ? null : styles.open,
                      ].filter(Boolean).join(' ')}
                      onClick={() => setMethodId(m.id)}
                    >
                      <span className={styles.payIcon}>{m.icon}</span>
                      <b>{t(m.label)}</b>
                      <span className={styles.sub}>{t(m.hint)}</span>
                      <span className={styles.radio} />
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* ---------- 2. collect ---------- */}
          {step === 2 && method && (
            <div className={styles.card}>
              <h4>
                {method.paid ? t('close.collectWith', { method: t(method.label) }) : t('close.openCharge')}
              </h4>
              <p className={styles.hint}>
                {t(collecting
                  ? 'close.confirmCollect'
                  : method.paid ? 'close.confirmAmount' : 'close.willCloseOpen')}
              </p>

              {/* Closing shows the figure; collecting lets it be typed down to a
                  part payment, which is the whole reason a receipt is its own
                  document rather than a flag on the invoice. */}
              {collecting ? (
                <TextField
                  label="close.amountReceived"
                  hint="close.amountHint"
                  inputMode="decimal"
                  autoFocus
                  value={amountText}
                  error={amountText.trim() !== '' && !amountValid
                    ? t('close.tooMuch', { owed: money(total) })
                    : undefined}
                  onChange={(e) => setAmountText(e.target.value)}
                />
              ) : (
                <div className={styles.payAmount}>
                  <span>{t('close.amountToCollect')}</span>
                  <b>{money(total)}</b>
                </div>
              )}

              {method.ref && (
                <TextField
                  label={method.ref}
                  hint="close.optional"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                />
              )}

              <div className={`${styles.info}${method.paid ? ` ${styles.ok}` : ''}`}>
                <span className={styles.infoIcon}>{method.paid ? <IconCard /> : 'i'}</span>
                <div>
                  <b>{t('close.willIssue', { doc })}</b>
                  <p>
                    {t(collecting
                      ? 'close.receiptOnFinish'
                      : method.paid ? 'close.sentOnFinish' : 'close.receiptLater')}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* ---------- 3. confirm ---------- */}
          {step === 3 && method && (
            <div className={styles.card}>
              <h4>{t('close.summary')}</h4>
              <p className={styles.hint}>{t(collecting ? 'close.checkBeforeCollect' : 'close.checkBefore')}</p>

              <dl className={`kv ${styles.kv}`}>
                <dt>{t('close.ticket')}</dt><dd>#{ticketNumber}</dd>
                <dt>{t('close.customer')}</dt><dd>{customer}</dd>
                <dt>{t('close.vehicle')}</dt><dd>{car} · {plate}</dd>
                {collecting && docnum && (<><dt>{t('close.docCollect')}</dt><dd>#{docnum}</dd></>)}
                <dt>{t('close.method')}</dt><dd>{method.icon} {t(method.label)}</dd>
                {reference && method.ref && (<><dt>{t(method.ref)}</dt><dd>{reference}</dd></>)}
                <dt>{t('close.documentToIssue')}</dt><dd>{doc}</dd>
                <dt>{t('close.total')}</dt><dd><b className={styles.big}>{money(amount)}</b></dd>
              </dl>

              <div className={`${styles.info}${method.paid ? ` ${styles.ok}` : ''}`}>
                <span className={styles.infoIcon}>{method.paid ? <IconCheck /> : 'i'}</span>
                <div>
                  <b>
                    {collecting
                      ? t(full ? 'close.willSettleInvoice' : 'close.willLeaveBalance', {
                          left: money(round2(total - amount)),
                        })
                      : t(method.paid ? 'close.willClosePaid' : 'close.willCloseBalance')}
                  </b>
                  <p>{t('close.issued', { doc })}</p>
                </div>
              </div>
            </div>
          )}
        </div>

        <footer className={styles.foot}>
          <Button
            onClick={step === 1 ? () => answer(null) : () => setStep(step - 1)}
            disabled={state === 'charging'}
          >
            {step === 1 ? t('common.cancel') : t('close.back')}
          </Button>
          <Button
            variant="primary"
            className={styles.next}
            onClick={next}
            disabled={blocked}
          >
            {state === 'charging' ? (
              <><span className={styles.spinner} /> {t('close.charging')}</>
            ) : step === 3 ? (
              collecting
                ? t('close.collectNow', { amount: money(amount) })
                : method?.paid ? t('close.collectAmount', { amount: money(total) }) : t('close.closeTicket')
            ) : (
              t('close.next')
            )}
          </Button>
        </footer>
      </aside>
    </div>
  );
}
