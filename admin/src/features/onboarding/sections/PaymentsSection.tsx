import { useTranslation } from 'react-i18next';
import { PELECARD_TEST_TERMINAL } from '../../../../../packages/ops/src/onboarding/rules';
import { CheckboxField, Note, Section, SelectField, TextField } from '../../../components';
import type { PaymentsMode } from '../formState';
import styles from '../OnboardingPage.module.css';
import type { OnboardingApi } from '../useOnboarding';

const MODES: PaymentsMode[] = ['none', 'installments', 'pelecard'];

export function PaymentsSection({ api }: { api: OnboardingApi }) {
  const { t } = useTranslation();
  const { form, update, errorFor } = api;
  const isTest = form.terminal.trim() === PELECARD_TEST_TERMINAL;

  return (
    <Section title="console.onboard.payments.title">
      <div className={styles.grid}>
        <SelectField
          label="console.onboard.payments.mode"
          value={form.paymentsMode}
          onChange={(e) => update('paymentsMode', e.target.value as PaymentsMode)}
          hint={`console.onboard.payments.modeHints.${form.paymentsMode}`}
        >
          {MODES.map((m) => <option key={m} value={m}>{t(`console.onboard.payments.modes.${m}`)}</option>)}
        </SelectField>
      </div>

      {form.paymentsMode === 'pelecard' && (
        <>
          <Note>{t('console.onboard.payments.noCall')}</Note>
          <div className={styles.grid}>
            <TextField
              label="console.onboard.payments.terminal"
              required
              dir="ltr"
              autoComplete="off"
              value={form.terminal}
              onChange={(e) => update('terminal', e.target.value)}
              error={errorFor('payments.terminal')}
              hint={isTest ? 'console.onboard.payments.testTerminal' : undefined}
            />
            <TextField
              label="console.onboard.payments.user"
              required
              dir="ltr"
              autoComplete="off"
              value={form.terminalUser}
              onChange={(e) => update('terminalUser', e.target.value)}
              error={errorFor('payments.user')}
            />
            <TextField
              label="console.onboard.payments.password"
              required
              type="password"
              dir="ltr"
              autoComplete="off"
              value={form.terminalPassword}
              onChange={(e) => update('terminalPassword', e.target.value)}
              error={errorFor('payments.password')}
            />
            <TextField
              label="console.onboard.payments.shopNo"
              dir="ltr"
              value={form.shopNo}
              onChange={(e) => update('shopNo', e.target.value)}
              hint="console.onboard.payments.shopNoHint"
            />
          </div>

          {form.env === 'production' && isTest && (
            <CheckboxField
              label="console.onboard.payments.allowTestTerminal"
              hint="console.onboard.payments.allowTestTerminalHint"
              checked={form.allowTestTerminal}
              onChange={(e) => update('allowTestTerminal', e.target.checked)}
            />
          )}
          {form.env !== 'production' && form.terminal.trim() !== '' && !isTest && (
            <CheckboxField
              label="console.onboard.payments.realTerminal"
              hint="console.onboard.payments.realTerminalHint"
              checked={form.realTerminal}
              onChange={(e) => update('realTerminal', e.target.checked)}
            />
          )}
          <CheckboxField
            label="console.onboard.payments.active"
            hint="console.onboard.payments.activeHint"
            checked={form.paymentsActive}
            onChange={(e) => update('paymentsActive', e.target.checked)}
          />
        </>
      )}

      {form.paymentsMode !== 'none' && (
        <div className={styles.grid}>
          <TextField
            label="console.onboard.payments.maxInstallments"
            type="number"
            min="1"
            max="36"
            dir="ltr"
            value={form.maxInstallments}
            onChange={(e) => update('maxInstallments', e.target.value)}
            error={errorFor('payments.maxInstallments')}
            hint="console.onboard.payments.maxInstallmentsHint"
          />
          <TextField
            label="console.onboard.payments.installmentsMin"
            type="number"
            min="0"
            dir="ltr"
            value={form.installmentsMin}
            onChange={(e) => update('installmentsMin', e.target.value)}
            error={errorFor('payments.installmentsMin')}
          />
        </div>
      )}
      {errorFor('payments.active') && <Note tone="danger">{errorFor('payments.active')}</Note>}
    </Section>
  );
}
