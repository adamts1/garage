import { useTranslation } from 'react-i18next';
import type { GarageOverview, Letterhead } from '../../api/types';
import { CopyValue, KeyValue } from '../../components';
import { formatDate } from '../../lib/format';
import styles from './GaragesPage.module.css';
import { providerName } from './serviceStatus';

const LETTERHEAD_LABELS: Record<keyof Letterhead, string> = {
  printName: 'console.letterhead.printName',
  motto: 'console.letterhead.motto',
  services: 'console.letterhead.services',
  address: 'console.letterhead.address',
  phone: 'console.letterhead.phone',
  fax: 'console.letterhead.fax',
  licenseNo: 'console.letterhead.licenseNo',
  taxId: 'console.letterhead.taxId',
};

/** Everything known about one garage, under its row. */
export function GarageDetails({ garage: g }: { garage: GarageOverview }) {
  const { t } = useTranslation();
  const yesNo = (v: boolean) => t(v ? 'console.common.yes' : 'console.common.no');

  return (
    <div className={styles.details}>
      <div>
        <h4>{t('console.garages.id')}</h4>
        <CopyValue value={g.id} />

        <h4>{t('console.garages.members')}</h4>
        <ul className={styles.members}>
          {g.members.map((m) => (
            <li key={m.email}>
              <span dir="ltr">{m.email}</span> · {t(`console.roles.${m.role}`)}
              <span className={styles.muted}> · {t('console.garages.lastSignIn', { date: formatDate(m.lastSignIn) })}</span>
            </li>
          ))}
          {g.members.length === 0 && <li className={styles.muted}>{t('console.garages.noMembers')}</li>}
        </ul>
      </div>

      <div>
        <h4>{t('console.garages.letterhead')}</h4>
        <KeyValue
          items={(Object.keys(LETTERHEAD_LABELS) as (keyof Letterhead)[]).map((k) => ({
            label: LETTERHEAD_LABELS[k],
            value: g.letterhead[k],
          }))}
        />
      </div>

      <div>
        <h4>{t('console.services.invoicing')}</h4>
        {g.invoicing ? (
          <KeyValue
            items={[
              { label: 'console.invoicing.provider', value: providerName(g.invoicing.provider) },
              { label: 'console.invoicing.active', value: yesNo(g.invoicing.active) },
              { label: 'console.invoicing.credentials', value: t(g.invoicing.credentials ? 'console.invoicing.stored' : 'console.invoicing.missing') },
              { label: 'console.invoicing.docType', value: t(`console.docTypes.${g.invoicing.docType}`) },
              { label: 'console.invoicing.vat', value: `${Math.round(g.invoicing.vatRate * 1000) / 10}%` },
              { label: 'console.bookkeeping.software', value: g.bookkeeping?.software ? t(`console.software.${g.bookkeeping.software}`) : null },
              { label: 'console.bookkeeping.accountantEmail', value: g.bookkeeping?.accountantEmail },
              { label: 'console.common.updated', value: formatDate(g.invoicing.updatedAt) },
            ]}
          />
        ) : <p className={styles.muted}>{t('console.services.notConnected')}</p>}

        <h4>{t('console.services.payments')}</h4>
        {g.payments ? (
          <KeyValue
            items={[
              { label: 'console.payments.provider', value: g.payments.credentials ? providerName(g.payments.provider) : t('console.payments.noProvider') },
              { label: 'console.invoicing.active', value: yesNo(g.payments.active) },
              { label: 'console.payments.shopNo', value: g.payments.shopNo ?? t('console.payments.noTerminal') },
              { label: 'console.payments.installments', value: t('console.payments.installmentsValue', { max: g.payments.maxInstallments, min: g.payments.installmentsMin }) },
              ...(g.payments.authFailedAt
                ? [{ label: 'console.payments.suspended', value: `${formatDate(g.payments.authFailedAt)} · ${g.payments.authError ?? ''}` }]
                : []),
            ]}
          />
        ) : <p className={styles.muted}>{t('console.services.notConnected')}</p>}
      </div>
    </div>
  );
}
