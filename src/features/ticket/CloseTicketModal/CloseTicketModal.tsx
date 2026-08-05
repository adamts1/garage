import { money } from '@garage/shared';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../../components/Button';
import { TextField } from '../../../components/Field';
import type { ModalComponentProps } from '../../../components/Modal/types';
import { IconCard, IconCheck } from '../../../icons';
import { settleModal } from '../../../store/useModalResult';
import styles from './CloseTicketModal.module.css';

export interface CloseResult {
  paid: boolean;
  method: string;
  doc: string;
  reference?: string;
}

interface Method {
  id: string;
  /** i18n key. */
  label: string;
  icon: string;
  /** i18n key for the one-line explanation. */
  hint: string;
  /** i18n key for what the reference field asks for, if anything. */
  ref?: string;
  paid: boolean;
}

const METHODS: Method[] = [
  { id: 'cash', label: 'close.methods.cash', icon: '💵', hint: 'close.methods.cashHint', paid: true },
  { id: 'card', label: 'close.methods.card', icon: '💳', hint: 'close.methods.cardHint', ref: 'close.methods.cardRef', paid: true },
  { id: 'bit', label: 'close.methods.bit', icon: '📱', hint: 'close.methods.bitHint', ref: 'close.methods.reference', paid: true },
  { id: 'transfer', label: 'close.methods.transfer', icon: '🏦', hint: 'close.methods.transferHint', ref: 'close.methods.reference', paid: true },
  { id: 'check', label: 'close.methods.check', icon: '🧾', hint: 'close.methods.checkHint', ref: 'close.methods.checkRef', paid: true },
  { id: 'open', label: 'close.methods.open', icon: '🕓', hint: 'close.methods.openHint', paid: false },
];

const STEP_KEYS = ['close.steps.method', 'close.steps.collect', 'close.steps.summary'];

/** Stand-in for the terminal / provider round-trip. */
const CHARGE_MS = 900;
/** How long the success screen shows before the drawer hands its answer back. */
const SUCCESS_MS = 1500;

/** Reached through `useCloseTicket()`. Resolves the result, or null if dismissed. */
export default function CloseTicketModal({ props, onClose }: ModalComponentProps) {
  const { t } = useTranslation();

  const resultId = String(props.resultId ?? '');
  const ticketNumber = String(props.ticketNumber ?? '');
  const customer = String(props.customer ?? '');
  const car = String(props.car ?? '');
  const plate = String(props.plate ?? '');
  const total = Number(props.total ?? 0);

  const [step, setStep] = useState(1);
  const [methodId, setMethodId] = useState<string | null>(null);
  const [reference, setReference] = useState('');
  const [state, setState] = useState<'form' | 'charging' | 'done'>('form');

  const method = METHODS.find((m) => m.id === methodId) ?? null;
  const doc = t(method?.paid ? 'close.docReceipt' : 'close.docInvoice');

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
        method: t(method.label),
        doc,
        reference: reference || undefined,
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

  if (state === 'done' && method) {
    return (
      <div className={styles.scrim}>
        <aside className={styles.drawer}>
          <div className={styles.success}>
            <div className={styles.burst}>
              <span className={styles.ring} />
              <span className={styles.tick}><IconCheck /></span>
            </div>
            <h3>{t(method.paid ? 'close.successPaid' : 'close.successClosed')}</h3>
            <p className={styles.amount}>{money(total)}</p>
            <p className={styles.docLine}>
              {method.paid
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
          <h3>{t('close.title')}</h3>
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
                  <span className={styles.key}>{t('close.amountDue')}</span>
                  <b>{money(total)}</b>
                </div>
              </div>

              <div className={styles.card}>
                <h4>{t('close.howPaying')}</h4>
                <p className={styles.hint}>{t('close.pickMethod')}</p>

                <div className={styles.payGrid}>
                  {METHODS.map((m) => (
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
                {t(method.paid ? 'close.confirmAmount' : 'close.willCloseOpen')}
              </p>

              <div className={styles.payAmount}>
                <span>{t('close.amountToCollect')}</span>
                <b>{money(total)}</b>
              </div>

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
                  <p>{t(method.paid ? 'close.sentOnFinish' : 'close.receiptLater')}</p>
                </div>
              </div>
            </div>
          )}

          {/* ---------- 3. confirm ---------- */}
          {step === 3 && method && (
            <div className={styles.card}>
              <h4>{t('close.summary')}</h4>
              <p className={styles.hint}>{t('close.checkBefore')}</p>

              <dl className={`kv ${styles.kv}`}>
                <dt>{t('close.ticket')}</dt><dd>#{ticketNumber}</dd>
                <dt>{t('close.customer')}</dt><dd>{customer}</dd>
                <dt>{t('close.vehicle')}</dt><dd>{car} · {plate}</dd>
                <dt>{t('close.method')}</dt><dd>{method.icon} {t(method.label)}</dd>
                {reference && method.ref && (<><dt>{t(method.ref)}</dt><dd>{reference}</dd></>)}
                <dt>{t('close.documentToIssue')}</dt><dd>{doc}</dd>
                <dt>{t('close.total')}</dt><dd><b className={styles.big}>{money(total)}</b></dd>
              </dl>

              <div className={`${styles.info}${method.paid ? ` ${styles.ok}` : ''}`}>
                <span className={styles.infoIcon}>{method.paid ? <IconCheck /> : 'i'}</span>
                <div>
                  <b>{t(method.paid ? 'close.willClosePaid' : 'close.willCloseBalance')}</b>
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
            disabled={(step === 1 && !method) || state === 'charging'}
          >
            {state === 'charging' ? (
              <><span className={styles.spinner} /> {t('close.charging')}</>
            ) : step === 3 ? (
              method?.paid ? t('close.collectAmount', { amount: money(total) }) : t('close.closeTicket')
            ) : (
              t('close.next')
            )}
          </Button>
        </footer>
      </aside>
    </div>
  );
}
