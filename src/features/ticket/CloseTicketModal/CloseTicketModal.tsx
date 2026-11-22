import {
  CardStartError, DEFAULT_CARD_SETTINGS, cardPaymentReference, cardPaymentsActive, installmentsAllowed, money,
  startCardPayment, verifyCardPayment, type CardPayment, type CardSettings, type PayMethod,
  type PaymentPart,
} from '@garage/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../../components/Button';
import { SelectField, TextField } from '../../../components/Field';
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
  /** Paid IN FULL. A part payment is false here with a method beside it: the
   *  ticket is not settled, but money did change hands. */
  paid: boolean;
  /** A code, written into `tickets.pay_method`. Null for the open charge, which
   *  is the absence of a payment rather than one of its kinds — this drawer
   *  used to store the words "חיוב פתוח" in the column that answers "how were
   *  we paid", on a ticket nobody had paid. */
  method: PayMethod | null;
  doc: string;
  reference?: string;
  /** What is actually being collected — whatever was typed, which is the total
   *  unless this is a part payment. The caller needs the figure rather than
   *  having to infer it. Zero for the open charge. */
  amount: number;
  /** A card in regular installments: how many. Absent for a single payment
   *  and for every other method. */
  installments?: number;
  /** A card's details for the receipt: from the provider when it charged the
   *  card, else what was typed. Absent for every other method. */
  card?: Pick<PaymentPart, 'cardLast4' | 'cardType' | 'approvalNumber' | 'cardPaymentId'>;
}

/** Four digits typed into the card's reference field are its last four. */
const LAST4 = /^\d{4}$/;

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

/** The pause on "מבצע גבייה…" for a method nothing is charged through. */
const CHARGE_MS = 900;
/** How often an open card payment is checked with the server while its page
 *  is showing. The page's own return also triggers a check at once. */
const POLL_MS = 3000;
/** A hosted page expires within minutes. Past this the drawer stops asking,
 *  checks once more, and goes back to the form. */
const PAGE_TTL_MS = 15 * 60_000;
/** The screen's total and the bill's can land an agora apart; a card charged
 *  the bill's own figure has paid in full. Same tolerance as the server. */
const ROUNDING = 0.02;
/** How long the success screen shows before the drawer hands its answer back. */
const SUCCESS_MS = 1500;
/** Longer when it shows a card's approval: long enough to read it out to the
 *  customer or copy it down. A button ends it sooner. */
const SUCCESS_CARD_MS = 6000;

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
  /* Closing may take part of the bill now and leave the rest open, by any
     method. Off unless the caller says the rest can be tracked — see
     useCloseTicket. Collecting always may: it already has a bill to track it. */
  const editable = collecting || props.partial === true;
  /** The document being settled, shown while collecting so the advisor can see
   *  which bill the money is going against. */
  const docnum = String(props.docnum ?? '');
  /** Collected earlier in this same visit, by other methods, and not yet on
   *  any document — the drawer reopens on what is left after each part, and
   *  one receipt covers them all at the end. Zero on the first round. */
  const soFar = Number(props.soFar ?? 0);

  const ticketKey = String(props.ticketKey ?? '');
  /** Card payments this visit already took and holds for its receipt — the
   *  server does not hand them back as "already paid" to this round. */
  const claimed = String(props.claimed ?? '').split(',').filter(Boolean);

  const [step, setStep] = useState(1);
  const [methodId, setMethodId] = useState<string | null>(null);
  const [reference, setReference] = useState('');
  /* 'card' — a hosted payment page is open in the drawer, waiting on the
     customer. Only reached when the garage charges cards through the system. */
  const [state, setState] = useState<'form' | 'charging' | 'card' | 'done'>('form');

  /* Does this garage charge cards through a clearing provider? Then picking
     the card method charges it for real; otherwise the card method records a
     payment taken on a separate terminal, as it always has. */
  /* Null until read. Never guessed: a garage whose settings could not be read
     might charge cards through the system, and recording "paid by card" there
     without charging would be a payment that never happened. */
  const [settings, setSettings] = useState<CardSettings | null>(null);
  const [settingsFailed, setSettingsFailed] = useState(false);
  const cardOnline = settings ?? DEFAULT_CARD_SETTINGS;
  /* Chosen here, not on the provider's page, so it works the same whether the
     card is charged through the system or on a terminal it does not talk to. */
  const [installments, setInstallments] = useState(1);
  /* A card charged on a terminal the system does not talk to: its approval
     number, typed from the terminal's slip, for the receipt. */
  const [approval, setApproval] = useState('');
  /* A card the provider charged: its details, straight from the provider. */
  const [charged, setCharged] = useState<CardPayment | null>(null);
  const loadSettings = useCallback(() => {
    let live = true;
    setSettingsFailed(false);
    cardPaymentsActive()
      .then((r) => { if (live) setSettings(r); })
      .catch(() => { if (live) setSettingsFailed(true); });
    return () => { live = false; };
  }, []);
  useEffect(loadSettings, [loadSettings]);
  const [card, setCard] = useState<{ url: string; payment: CardPayment; since: number; terminal: boolean } | null>(null);
  /* A garage with a terminal: charge on it (the default — the customer is at
     the counter), or type the card on the page (a payment by phone). */
  const [onTerminal, setOnTerminal] = useState(true);
  const [cardError, setCardError] = useState<string | null>(null);
  const [cardNote, setCardNote] = useState<string | null>(null);
  /* Opens on the whole outstanding amount, because paying a bill in full is what
     usually happens and typing a total by hand is how a digit goes missing. */
  const [amountText, setAmountText] = useState(String(total));

  /* Collecting never offers the open charge: the bill has already been issued,
     and "pay later" is the state the ticket is already in. */
  const methods = collecting ? METHODS.filter((m) => m.paid) : METHODS;
  const method = methods.find((m) => m.id === methodId) ?? null;

  /* The open charge takes no money, so it has no figure to type. */
  const typing = editable && !!method?.paid;
  const typed = Number(String(amountText).replace(',', '.'));
  const amountValid = !typing
    || (Number.isFinite(typed) && typed > 0 && round2(typed) <= total);
  /* The figure can only go DOWN from the total. Closing bills the ticket's own
     works, and a total typed over them would be a document that disagrees with
     the job behind it; what can differ is how much of it arrives today. */
  const asked = !method?.paid ? 0 : typing ? round2(typed) : total;
  /* What was actually taken: a card the provider charged is whatever it
     charged — the server charges the bill's own figure when the card pays the
     rest — and everything else is what was typed. */
  const amount = charged ? charged.amount : asked;
  const full = !!method?.paid && amount >= round2(total - (charged ? ROUNDING : 0));
  /** Installments on offer for this card payment — 1 means none. */
  const maxPlan = method?.code === 'card' ? installmentsAllowed(cardOnline, asked) : 1;
  const plan = Math.min(installments, maxPlan);
  /** The plan the card was actually charged on, once it was. */
  const chargedPlan = charged ? charged.installments : plan;

  /* What the receipt is told about the card. Nothing that was not given:
     an empty field stays off the document rather than printing as blank. */
  const cardDetails = (): NonNullable<CloseResult['card']> => {
    if (charged) {
      return {
        cardPaymentId: charged.id,
        ...(charged.cardLast4 ? { cardLast4: charged.cardLast4 } : {}),
        ...(charged.cardType ? { cardType: charged.cardType } : {}),
        ...(charged.approvalNumber ? { approvalNumber: charged.approvalNumber } : {}),
      };
    }
    const last4 = reference.trim();
    const ok = approval.trim();
    return {
      ...(LAST4.test(last4) ? { cardLast4: last4 } : {}),
      ...(ok ? { approvalNumber: ok } : {}),
    };
  };
  /** Closing, with money taken but not all of it: the bill goes out as a חשבונית
   *  מס and this payment as a קבלה against it, exactly as if it had been
   *  collected later — which is what makes the rest collectable afterwards. */
  const partPaid = !collecting && !!method?.paid && !full;
  /** This round does not end the visit's payments, so nothing is issued by it:
   *  the drawer comes back on the rest, and the documents follow when the bill
   *  is paid or the drawer is closed. */
  const deferred = partPaid || (collecting && !full);

  const doc = t(collecting
    ? 'close.docCollect'
    : partPaid ? 'close.docInvoiceAndReceipt'
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

  /* Hands the answer back. From the timer below, or the button on the success
     screen — once, whichever comes first. */
  const finished = useRef(false);
  const finish = () => {
    if (finished.current || !method) return;
    finished.current = true;
    answerRef.current({
      paid: full,
      method: method.code,
      doc,
      reference: reference || undefined,
      amount,
      ...(chargedPlan > 1 ? { installments: chargedPlan } : {}),
      ...(method.code === 'card' ? { card: cardDetails() } : {}),
    });
  };
  const finishRef = useRef(finish);
  finishRef.current = finish;

  /** The card's details, shown on the success screen when there are any. */
  const shownCard = state === 'done' && method?.code === 'card' ? cardDetails() : null;
  const showsCard = !!shownCard && (!!shownCard.approvalNumber || !!shownCard.cardLast4 || chargedPlan > 1);

  useEffect(() => {
    if (state !== 'done' || !method) return;
    const timer = setTimeout(() => finishRef.current(), showsCard ? SUCCESS_CARD_MS : SUCCESS_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, method]);

  /** This round charges a card through the provider, not just records one. */
  const charging = method?.code === 'card' && cardOnline.active && !!ticketKey;
  /** …and on the garage's terminal. */
  const terminalRound = charging && cardOnline.terminal && onTerminal;
  /* Card payments switched off by the server because the provider rejected
     the credentials. A garage with a provider records no card by hand, so the
     card cannot be taken here until an admin reconnects. */
  const suspended = method?.code === 'card' && !!settings?.suspended;

  /* The customer has paid — on this page or, found by the server, on an
     earlier one. Either way the drawer moves on with the provider's record. */
  const paidWith = (p: CardPayment) => {
    setReference(cardPaymentReference(p));
    setCharged(p);
    setCard(null);
    setState('done');
  };

  /* Opens a fresh hosted page. Each attempt is its own: a page is single-use
     and expires within minutes, so "try again" is always a new one. */
  const startCard = async (force = false) => {
    setState('charging');
    setCardError(null);
    setCardNote(null);
    try {
      const started = await startCardPayment(ticketKey, asked, plan, window.location.origin, { claimed, force, terminal: terminalRound });
      if (started.recovered) {
        // Money already taken on an earlier attempt: that is this payment.
        setCardNote(t('close.cardOnline.recovered'));
        paidWith(started.payment);
        return;
      }
      setCard({ url: started.url, payment: started.payment, since: Date.now(), terminal: terminalRound });
      setState('card');
    } catch (e) {
      setState('form');
      if (e instanceof CardStartError && e.code === 'payments_suspended') loadSettings();
      if (e instanceof CardStartError && e.code === 'payment_open') {
        /* An earlier page on this ticket may still be completed. Opening a
           second one is how a customer pays twice, so it is asked, not done. */
        if (window.confirm(t('close.cardOnline.openConfirm'))) void startCard(true);
        return;
      }
      setCardError(e instanceof Error ? e.message : String(e));
    }
  };

  /* Asks the server what became of the open payment. Only the server's answer
     — the provider's record, validated — moves the drawer on. */
  const checking = useRef(false);
  const check = useCallback(async (): Promise<CardPayment | null> => {
    if (!card || checking.current) return null;
    checking.current = true;
    try {
      const p = await verifyCardPayment(card.payment.id);
      if (p.status === 'paid') {
        paidWith(p);
      } else if (p.status === 'declined') {
        setCard(null);
        setCardError(p.message ?? t('close.cardOnline.declined'));
        setState('form');
      }
      return p;
    } catch {
      return null; // a failed check is not a verdict; the next one will ask again
    } finally {
      checking.current = false;
    }
     
  }, [card, t]);

  /* Leaving an open payment — asked by the advisor, or because the page came
     back cancelled, or because it is too old to be completed. It is checked
     one last time first: if the customer finished it a second ago, that is a
     payment, not an abort. */
  const leaveCard = async (note: string) => {
    const p = await check();
    if (p?.status === 'paid' || p?.status === 'declined') return;
    setCard(null);
    setState('form');
    setCardNote(note);
  };
  const leaveRef = useRef(leaveCard);
  leaveRef.current = leaveCard;

  useEffect(() => {
    if (state !== 'card' || !card) return;
    const timer = setInterval(() => {
      if (Date.now() - card.since > PAGE_TTL_MS) void leaveRef.current(t('close.cardOnline.stillPending'));
      else void check();
    }, POLL_MS);
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.data?.type !== 'card-payment-return') return;
      /* The page's own cancel and error buttons land here too. A cancelled
         page has no verdict at the provider (it stays "not found"), so the
         drawer would otherwise wait on it until it expired. */
      if (e.data.result === 'cancel') void leaveRef.current(t('close.cardOnline.cancelled'));
      /* Pelecard sends a declined card here too — the check inside leaveCard
         finds the decline and shows the bank's reason. */
      else if (e.data.result === 'error') void leaveRef.current(t('close.cardOnline.stillPending'));
      else void check();
    };
    window.addEventListener('message', onMessage);
    return () => { clearInterval(timer); window.removeEventListener('message', onMessage); };
  }, [state, card, check, t]);

  const abortCard = async () => {
    if (!window.confirm(t('close.cardOnline.abortConfirm'))) return;
    await leaveCard(t('close.cardOnline.stillPending'));
  };

  const charge = () => {
    if (charging) { void startCard(); return; }
    /* Never "recorded" while it is unknown whether this garage charges cards
       through the system — see `settings`. */
    if (method?.code === 'card' && !settings) return;
    setState('charging');
    setTimeout(() => setState('done'), CHARGE_MS);
  };

  const next = () => (step < 3 ? setStep(step + 1) : charge());

  /* What blocks "המשך" on each step: no method chosen, or — collecting — an
     amount that is not a sum of money this bill can still take. */
  const blocked = (step === 1 && !method)
    || (method?.code === 'card' && !settings)
    || suspended
    || (step === 2 && !amountValid)
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
              {t(collecting || partPaid
                ? 'close.successCollected'
                : method.paid ? 'close.successPaid' : 'close.successClosed')}
            </h3>
            <p className={styles.amount}>{money(method.paid ? amount : total)}</p>
            <p className={styles.docLine}>
              {collecting || partPaid
                ? t('close.collectedWith', { method: t(method.label) })
                : method.paid
                  ? t('close.paidWith', { method: t(method.label) })
                  : t('close.openBalance')}
              {' · '}
              {t(deferred ? 'close.issuedAtEnd' : 'close.issued', { doc })}
            </p>
            {!full && method.paid && (
              <p className={styles.docLine}>
                {t('close.leftToPay', { left: money(round2(total - amount)) })}
              </p>
            )}

            {/* The card's approval, as the provider (or the slip) gave it — the
                customer may ask for it, and the N6 prints no slip. */}
            {showsCard && shownCard && (
              <dl className={`kv ${styles.approval}`}>
                {shownCard.approvalNumber && (
                  <><dt>{t('close.methods.cardApproval')}</dt><dd><b>{shownCard.approvalNumber}</b></dd></>
                )}
                {(shownCard.cardLast4 || charged?.cardBrand) && (
                  <><dt>{t('close.card')}</dt>
                    <dd>{[charged?.cardBrand, shownCard.cardLast4 ? `****${shownCard.cardLast4}` : null].filter(Boolean).join(' · ')}</dd></>
                )}
                {chargedPlan > 1 && (
                  <><dt>{t('close.installments.label')}</dt><dd>{t('close.installments.summary', { count: chargedPlan })}</dd></>
                )}
              </dl>
            )}
            {showsCard && (
              <Button variant="primary" onClick={finish}>{t('close.next')}</Button>
            )}
          </div>
        </aside>
      </div>
    );
  }

  return (
    <div
      className={styles.scrim}
      onMouseDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (state === 'card') void abortCard();
        else if (state !== 'charging') answer(null);
      }}
    >
      <aside className={styles.drawer} role="dialog" aria-modal="true">
        <header className={styles.head}>
          <button
            type="button"
            className={styles.close}
            onClick={() => (state === 'card' ? void abortCard() : answer(null))}
            disabled={state === 'charging'}
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
          {/* ---------- the provider's payment page ----------
              Card details are typed there, or handed to the garage's terminal
              by its own button — never into this app. */}
          {state === 'card' && card && (
            <div className={`${styles.card} ${styles.cardFrame}`}>
              <h4>{t('close.cardOnline.title', { amount: money(amount) })}</h4>
              <p className={styles.hint}>{t(card.terminal ? 'close.cardOnline.waitingTerminal' : 'close.cardOnline.waitingTyped')}</p>
              <iframe
                className={styles.payFrame}
                src={card.url}
                title={t('close.cardOnline.frameTitle')}
                allow="payment"
              />
            </div>
          )}

          {/* ---------- 1. which payment method ---------- */}
          {state !== 'card' && step === 1 && (
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
                  {soFar > 0 && (
                    <>
                      <span className={styles.key}>{t('close.paidThisVisit')}</span>
                      <b>{money(soFar)}</b>
                    </>
                  )}
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
                      <span className={styles.sub}>
                        {t(m.code === 'card' && cardOnline.active
                          ? cardOnline.terminal ? 'close.cardOnline.hintTerminal' : 'close.cardOnline.hint'
                          : m.hint)}
                      </span>
                      <span className={styles.radio} />
                    </button>
                  ))}
                </div>
                {suspended && (
                  <div className={`${styles.info} ${styles.bad}`} role="alert">
                    <span className={styles.infoIcon}>!</span>
                    <div>
                      <b>{t('close.cardOnline.suspended')}</b>
                      <p>{settings?.suspended}</p>
                    </div>
                  </div>
                )}
                {method?.code === 'card' && settingsFailed && (
                  <div className={`${styles.info} ${styles.bad}`} role="alert">
                    <span className={styles.infoIcon}>!</span>
                    <div>
                      <b>{t('close.cardOnline.settingsFailed')}</b>
                      <p><Button onClick={loadSettings}>{t('close.cardOnline.retry')}</Button></p>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          {/* ---------- 2. collect ---------- */}
          {state !== 'card' && step === 2 && method && (
            <div className={styles.card}>
              <h4>
                {method.paid ? t('close.collectWith', { method: t(method.label) }) : t('close.openCharge')}
              </h4>
              <p className={styles.hint}>
                {t(collecting
                  ? 'close.confirmCollect'
                  : method.paid ? 'close.confirmAmount' : 'close.willCloseOpen')}
              </p>

              {/* The figure can be typed down to a part payment, which is the
                  whole reason a receipt is its own document rather than a flag
                  on the invoice. Where it cannot, it is only shown. */}
              {typing ? (
                <TextField
                  label="close.amountReceived"
                  hint={collecting ? 'close.amountHint' : 'close.partialHint'}
                  inputMode="decimal"
                  autoFocus
                  value={amountText}
                  error={amountText.trim() !== '' && !amountValid
                    ? t('close.tooMuch', { owed: money(total) })
                    : undefined}
                  onChange={(e) => setAmountText(e.target.value)}
                />
              ) : method.paid ? (
                <div className={styles.payAmount}>
                  <span>{t('close.amountToCollect')}</span>
                  <b>{money(total)}</b>
                </div>
              ) : null}

              {/* Where the card is: at the terminal, or read out over the phone. */}
              {charging && cardOnline.terminal && (
                <div className={styles.entryChoice} role="radiogroup" aria-label={t('close.cardOnline.entry')}>
                  {[true, false].map((term) => (
                    <button
                      type="button"
                      key={String(term)}
                      role="radio"
                      aria-checked={onTerminal === term}
                      className={`${styles.payCard}${onTerminal === term ? ` ${styles.on}` : ''}`}
                      onClick={() => setOnTerminal(term)}
                    >
                      <span className={styles.payIcon}>{term ? '📟' : '⌨️'}</span>
                      <b>{t(term ? 'close.cardOnline.onTerminal' : 'close.cardOnline.typed')}</b>
                      <span className={styles.sub}>{t(term ? 'close.cardOnline.onTerminalHint' : 'close.cardOnline.typedHint')}</span>
                      <span className={styles.radio} />
                    </button>
                  ))}
                </div>
              )}

              {/* Regular installments, chosen here for a card however it is taken.
                  The provider is then told exactly this number. */}
              {maxPlan > 1 && (
                <SelectField
                  label="close.installments.label"
                  hint="close.installments.hint"
                  value={String(plan)}
                  onChange={(e) => setInstallments(Number(e.target.value))}
                >
                  {Array.from({ length: maxPlan }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>
                      {n === 1
                        ? t('close.installments.single')
                        : t('close.installments.option', { count: n, each: money(round2(amount / n)) })}
                    </option>
                  ))}
                </SelectField>
              )}

              {/* A card charged through the provider gets its reference from the
                  provider's record — the last digits and the approval number. */}
              {method.ref && !charging && (
                <TextField
                  label={method.ref}
                  hint="close.optional"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                />
              )}
              {method.code === 'card' && !charging && (
                <TextField
                  label="close.methods.cardApproval"
                  hint="close.optional"
                  value={approval}
                  onChange={(e) => setApproval(e.target.value.replace(/[^0-9A-Za-z-]/g, '').slice(0, 20))}
                />
              )}

              <div className={`${styles.info}${method.paid ? ` ${styles.ok}` : ''}`}>
                <span className={styles.infoIcon}>{method.paid ? <IconCard /> : 'i'}</span>
                <div>
                  <b>{t(deferred ? 'close.issuedAtEnd' : 'close.willIssue', { doc })}</b>
                  <p>
                    {t(collecting
                      ? deferred ? 'close.oneReceipt' : 'close.receiptOnFinish'
                      : partPaid ? 'close.restLater'
                        : method.paid ? 'close.sentOnFinish' : 'close.receiptLater')}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* ---------- 3. confirm ---------- */}
          {state !== 'card' && step === 3 && method && (
            <div className={styles.card}>
              <h4>{t('close.summary')}</h4>
              <p className={styles.hint}>{t(collecting ? 'close.checkBeforeCollect' : 'close.checkBefore')}</p>

              <dl className={`kv ${styles.kv}`}>
                <dt>{t('close.ticket')}</dt><dd>#{ticketNumber}</dd>
                <dt>{t('close.customer')}</dt><dd>{customer}</dd>
                <dt>{t('close.vehicle')}</dt><dd>{car} · {plate}</dd>
                {collecting && docnum && (<><dt>{t('close.docCollect')}</dt><dd>#{docnum}</dd></>)}
                <dt>{t('close.method')}</dt><dd>{method.icon} {t(method.label)}{charging && cardOnline.terminal ? ` · ${t(onTerminal ? 'close.cardOnline.onTerminal' : 'close.cardOnline.typed')}` : ''}</dd>
                {plan > 1 && (<><dt>{t('close.installments.label')}</dt><dd>{t('close.installments.summary', { count: plan })}</dd></>)}
                {reference && method.ref && (<><dt>{t(method.ref)}</dt><dd>{reference}</dd></>)}
                {approval && method.code === 'card' && !charging && (<><dt>{t('close.methods.cardApproval')}</dt><dd>{approval}</dd></>)}
                <dt>{t('close.documentToIssue')}</dt><dd>{doc}</dd>
                {partPaid && (<><dt>{t('close.amountDue')}</dt><dd>{money(total)}</dd></>)}
                <dt>{t(partPaid ? 'close.amountReceived' : 'close.total')}</dt>
                <dd><b className={styles.big}>{money(method.paid ? amount : total)}</b></dd>
              </dl>

              <div className={`${styles.info}${method.paid ? ` ${styles.ok}` : ''}`}>
                <span className={styles.infoIcon}>{method.paid ? <IconCheck /> : 'i'}</span>
                <div>
                  <b>
                    {collecting || partPaid
                      ? t(collecting && full ? 'close.willSettleInvoice' : 'close.willLeaveBalance', {
                          left: money(round2(total - amount)),
                        })
                      : t(method.paid ? 'close.willClosePaid' : 'close.willCloseBalance')}
                  </b>
                  <p>{t(deferred ? 'close.issuedAtEnd' : 'close.issued', { doc })}</p>
                </div>
              </div>

              {cardError && (
                <div className={`${styles.info} ${styles.bad}`} role="alert">
                  <span className={styles.infoIcon}>!</span>
                  <div>
                    <b>{t('close.cardOnline.declined')}</b>
                    <p>{cardError}</p>
                  </div>
                </div>
              )}
              {cardNote && (
                <div className={styles.info} role="status">
                  <span className={styles.infoIcon}>i</span>
                  <div><p>{cardNote}</p></div>
                </div>
              )}
            </div>
          )}
        </div>

        {state === 'card' ? (
          <footer className={styles.foot}>
            <Button onClick={() => void abortCard()}>{t('close.cardOnline.abort')}</Button>
          </footer>
        ) : (
        <footer className={styles.foot}>
          <Button
            onClick={step === 1 ? () => answer(null) : () => setStep(step - 1)}
            disabled={state === 'charging'}
          >
            {/* Once part of the bill is in, closing is not cancelling: what was
                taken gets its receipt, and the rest stays owed. Said on the
                button, because the ✕ does the same and says nothing. */}
            {step === 1
              ? soFar > 0 ? t('close.finishNow', { amount: money(soFar) }) : t('common.cancel')
              : t('close.back')}
          </Button>
          <Button
            variant="primary"
            className={styles.next}
            onClick={next}
            disabled={blocked}
          >
            {state === 'charging' ? (
              <><span className={styles.spinner} /> {t(charging ? 'close.cardOnline.opening' : 'close.charging')}</>
            ) : step === 3 && charging ? (
              t(cardError ? 'close.cardOnline.retry' : 'close.cardOnline.charge', { amount: money(amount) })
            ) : step === 3 ? (
              collecting
                ? deferred
                  ? t('close.recordPayment', { amount: money(amount) })
                  : t('close.collectNow', { amount: money(round2(soFar + amount)) })
                : method?.paid ? t('close.collectAmount', { amount: money(amount) }) : t('close.closeTicket')
            ) : (
              t('close.next')
            )}
          </Button>
        </footer>
        )}
      </aside>
    </div>
  );
}
