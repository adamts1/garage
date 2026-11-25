import {
  CardStartError, cardPaymentsActive, checkTerminal, verifyCardPayment,
  type CardPayment, type CardSettings,
} from '@garage/shared';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/Button';
import Modal from '../../components/Modal/Modal';
import type { ModalComponentProps } from '../../components/Modal/types';
import { settleModal } from '../../store/useModalResult';

/**
 * Checking the card terminal set-up, without moving money (admin).
 *
 * Two steps, each ONE call to the provider, pressed on purpose:
 *
 *   1. the credentials — does the provider accept them at all;
 *   2. a card check on the terminal (J2): the card is read, nothing charged.
 *
 * Either can switch card payments off for the garage: a provider that rejects
 * the credentials does so after a few tries by locking the account, so the
 * server stops at the first rejection (see migration 20261123090000). That is
 * why this asks before each step and never repeats one by itself.
 */

type Step =
  | { kind: 'idle' }
  | { kind: 'busy'; what: 'credentials' | 'card' }
  | { kind: 'card'; url: string; payment: CardPayment }
  | { kind: 'ok'; what: 'credentials' | 'card'; payment?: CardPayment }
  | { kind: 'failed'; message: string; suspended: boolean };

const POLL_MS = 3000;
const GIVE_UP_MS = 3 * 60_000;

export default function TerminalCheckModal({ props, isTop, stacked, onClose }: ModalComponentProps) {
  const { t } = useTranslation();
  const resultId = String(props.resultId ?? '');
  const [settings, setSettings] = useState<CardSettings | null>(null);
  const [step, setStep] = useState<Step>({ kind: 'idle' });
  const since = useRef(0);

  useEffect(() => {
    cardPaymentsActive().then(setSettings).catch(() => setSettings(null));
  }, []);

  const close = () => { settleModal(resultId, true); onClose(); };

  const run = async (what: 'credentials' | 'card') => {
    if (!window.confirm(t(what === 'card' ? 'terminalCheck.confirmCard' : 'terminalCheck.confirmCredentials'))) return;
    setStep({ kind: 'busy', what });
    try {
      const r = await checkTerminal(what, window.location.origin);
      if ('ok' in r) setStep({ kind: 'ok', what });
      else { since.current = Date.now(); setStep({ kind: 'card', url: r.url, payment: r.payment }); }
    } catch (e) {
      const suspended = e instanceof CardStartError && e.code === 'payments_suspended';
      setStep({ kind: 'failed', message: e instanceof Error ? e.message : String(e), suspended });
    }
  };

  /* The card check's answer, from the server — as for a payment. */
  useEffect(() => {
    if (step.kind !== 'card') return;
    const poll = async () => {
      try {
        const p = await verifyCardPayment(step.payment.id);
        if (p.status === 'paid') setStep({ kind: 'ok', what: 'card', payment: p });
        else if (p.status === 'declined') setStep({ kind: 'failed', message: p.message ?? '', suspended: false });
        else if (Date.now() - since.current > GIVE_UP_MS) setStep({ kind: 'failed', message: t('terminalCheck.noCard'), suspended: false });
      } catch (e) {
        if (e instanceof Error && /suspended/.test(e.message)) setStep({ kind: 'failed', message: e.message, suspended: true });
      }
    };
    const timer = setInterval(() => void poll(), POLL_MS);
    return () => clearInterval(timer);
  }, [step, t]);

  const busy = step.kind === 'busy' || step.kind === 'card';

  return (
    <Modal
      title="terminalCheck.title"
      size={step.kind === 'card' ? 'lg' : 'md'}
      isTop={isTop}
      stacked={stacked}
      onClose={close}
      actions={<Button data-autofocus onClick={close}>{t('common.close')}</Button>}
    >
      <p>{t('terminalCheck.body')}</p>

      {settings?.suspended && (
        <p role="alert"><b>{t('terminalCheck.suspended')}</b> {settings.suspended}</p>
      )}

      <ol>
        <li>
          <p>{t('terminalCheck.step1')}</p>
          <Button onClick={() => void run('credentials')} disabled={busy || !!settings?.suspended || !settings?.active}>
            {t('terminalCheck.runCredentials')}
          </Button>
        </li>
        <li>
          <p>{t('terminalCheck.step2')}</p>
          <Button onClick={() => void run('card')} disabled={busy || !!settings?.suspended || !settings?.terminal}>
            {t('terminalCheck.runCard')}
          </Button>
          {settings && !settings.terminal && <p>{t('terminalCheck.noTerminal')}</p>}
        </li>
      </ol>

      {step.kind === 'busy' && <p>{t('terminalCheck.busy')}</p>}

      {step.kind === 'card' && (
        <>
          <p>{t('terminalCheck.tapCard')}</p>
          <iframe src={step.url} title={t('close.cardOnline.frameTitle')} allow="payment" style={{ width: '100%', minHeight: 520, border: '1px solid #e3e6ec', borderRadius: 12 }} />
        </>
      )}

      {step.kind === 'ok' && (
        <p role="status">
          <b>{t(step.what === 'card' ? 'terminalCheck.okCard' : 'terminalCheck.okCredentials')}</b>
          {step.payment?.cardLast4 && ` ****${step.payment.cardLast4}`}
          {step.payment?.approvalNumber && ` · ${t('close.methods.cardApproval')} ${step.payment.approvalNumber}`}
        </p>
      )}

      {step.kind === 'failed' && (
        <p role="alert">
          <b>{t(step.suspended ? 'terminalCheck.suspended' : 'terminalCheck.failed')}</b> {step.message}
        </p>
      )}
    </Modal>
  );
}
