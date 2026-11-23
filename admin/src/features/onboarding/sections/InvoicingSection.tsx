import { useTranslation } from 'react-i18next';
import type { BookkeepingSoftware, InvoiceDocType } from '../../../api/types';
import { CheckboxField, Section, SelectField, TextField } from '../../../components';
import styles from '../OnboardingPage.module.css';
import type { OnboardingApi } from '../useOnboarding';

const DOC_TYPES: InvoiceDocType[] = ['invoice_receipt', 'tax_invoice'];
const SOFTWARE: BookkeepingSoftware[] = ['rivhit', 'hashavshevet'];

/** iCount, plus the bookkeeping settings that live on the same row. */
export function InvoicingSection({ api }: { api: OnboardingApi }) {
  const { t } = useTranslation();
  const { form, update, errorFor } = api;

  return (
    <Section title="console.onboard.invoicing.title">
      <CheckboxField
        label="console.onboard.invoicing.enable"
        hint="console.onboard.invoicing.enableHint"
        checked={form.invoicingOn}
        onChange={(e) => update('invoicingOn', e.target.checked)}
      />

      {form.invoicingOn && (
        <>
          <div className={styles.grid}>
            <TextField
              label="console.onboard.invoicing.cid"
              required
              dir="ltr"
              autoComplete="off"
              value={form.cid}
              onChange={(e) => update('cid', e.target.value)}
              error={errorFor('invoicing.cid')}
            />
            <TextField
              label="console.onboard.invoicing.token"
              required
              type="password"
              dir="ltr"
              autoComplete="off"
              value={form.token}
              onChange={(e) => update('token', e.target.value)}
              error={errorFor('invoicing.token')}
              hint="console.onboard.invoicing.tokenHint"
            />
            <TextField
              label="console.onboard.invoicing.vatPercent"
              type="number"
              step="0.1"
              min="0"
              max="99"
              dir="ltr"
              value={form.vatPercent}
              onChange={(e) => update('vatPercent', e.target.value)}
              error={errorFor('invoicing.vatRate')}
            />
            <SelectField
              label="console.onboard.invoicing.docType"
              value={form.docType}
              onChange={(e) => update('docType', e.target.value as InvoiceDocType)}
            >
              {DOC_TYPES.map((d) => <option key={d} value={d}>{t(`console.docTypes.${d}`)}</option>)}
            </SelectField>
          </div>
          <CheckboxField
            label="console.onboard.invoicing.active"
            hint="console.onboard.invoicing.activeHint"
            checked={form.invoicingActive}
            onChange={(e) => update('invoicingActive', e.target.checked)}
          />

          <h4 className={styles.subhead}>{t('console.onboard.bookkeeping.title')}</h4>
          <div className={styles.grid}>
            <SelectField
              label="console.onboard.bookkeeping.software"
              value={form.software}
              onChange={(e) => update('software', e.target.value as BookkeepingSoftware | '')}
              error={errorFor('bookkeeping.software')}
              hint="console.onboard.bookkeeping.softwareHint"
            >
              <option value="">{t('console.onboard.bookkeeping.notYet')}</option>
              {SOFTWARE.map((s) => <option key={s} value={s}>{t(`console.software.${s}`)}</option>)}
            </SelectField>
            <TextField
              label="console.onboard.bookkeeping.accountantEmail"
              type="email"
              dir="ltr"
              value={form.accountantEmail}
              onChange={(e) => update('accountantEmail', e.target.value)}
              error={errorFor('bookkeeping.accountantEmail')}
            />
          </div>
        </>
      )}
    </Section>
  );
}
