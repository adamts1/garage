import { useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { EnvironmentInfo, GarageOverview, Letterhead } from '../../api/types';
import { CopyValue, EnvName, KeyValue, Modal, Pill } from '../../components';
import { formatDate } from '../../lib/format';
import styles from './GarageDetails.module.css';
import { InvoicingSwitch } from './InvoicingSwitch';
import { ServicePill } from './ServicePill';
import { bookkeepingStatus, garageIssues, invoicingStatus, paymentsStatus, providerName } from './serviceStatus';

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

/** A titled block in the drawer, with its status at the far end. */
function Card({ title, status, children }: { title: string; status?: ReactNode; children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <section className={styles.card}>
      <header className={styles.cardHead}>
        <h4>{t(title)}</h4>
        {status}
      </header>
      {children}
    </section>
  );
}

/** Everything known about one garage, in a side drawer. */
export function GarageDetails({ garage: g, env, onChanged, onClose }: {
  garage: GarageOverview;
  env: EnvironmentInfo;
  onChanged: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);
  const issues = garageIssues(g);
  const letterhead = (Object.keys(LETTERHEAD_LABELS) as (keyof Letterhead)[])
    .filter((k) => g.letterhead[k])
    .map((k) => ({ label: LETTERHEAD_LABELS[k], value: g.letterhead[k] }));

  return createPortal(
    <Modal title="console.garages.drawerTitle" titleValues={{ name: g.name }} variant="drawer" isTop={!confirming} onClose={onClose}>
      <div className={styles.meta}>
        <EnvName env={env} />
        <span>{t('console.garages.createdOn', { date: formatDate(g.createdAt) })}</span>
        <CopyValue value={g.id} />
      </div>

      {issues.length > 0 && (
        <ul className={styles.issues}>
          {issues.map((i) => (
            <li key={i.key} className={styles[i.tone]}>{t(i.key)}</li>
          ))}
        </ul>
      )}

      <Card title="console.services.invoicing" status={<ServicePill status={invoicingStatus(g)} />}>
        {g.invoicing ? (
          <>
            <KeyValue
              items={[
                { label: 'console.invoicing.provider', value: providerName(g.invoicing.provider) },
                { label: 'console.invoicing.credentials', value: t(g.invoicing.credentials ? 'console.invoicing.stored' : 'console.invoicing.missing') },
                { label: 'console.invoicing.docType', value: t(`console.docTypes.${g.invoicing.docType}`) },
                { label: 'console.invoicing.vat', value: `${Math.round(g.invoicing.vatRate * 1000) / 10}%` },
                { label: 'console.common.updated', value: formatDate(g.invoicing.updatedAt) },
              ]}
            />
            {g.invoicing.credentials && (
              <div className={styles.control}>
                <span>{t('console.invoicing.issuing')}</span>
                <InvoicingSwitch env={env.id} garage={g} onChanged={onChanged} onDialog={setConfirming} />
              </div>
            )}
          </>
        ) : <p className={styles.muted}>{t('console.garages.invoicingHowTo')}</p>}
      </Card>

      <Card title="console.services.payments" status={<ServicePill status={paymentsStatus(g)} />}>
        {g.payments ? (
          <KeyValue
            items={[
              { label: 'console.payments.provider', value: g.payments.credentials ? providerName(g.payments.provider) : t('console.payments.noProvider') },
              { label: 'console.payments.shopNo', value: g.payments.shopNo ?? t('console.payments.noTerminal') },
              { label: 'console.payments.installments', value: t('console.payments.installmentsValue', { max: g.payments.maxInstallments, min: g.payments.installmentsMin }) },
              ...(g.payments.authFailedAt
                ? [{ label: 'console.payments.suspended', value: `${formatDate(g.payments.authFailedAt)} · ${g.payments.authError ?? ''}` }]
                : []),
              { label: 'console.common.updated', value: formatDate(g.payments.updatedAt) },
            ]}
          />
        ) : <p className={styles.muted}>{t('console.garages.paymentsHowTo')}</p>}
      </Card>

      <Card title="console.services.bookkeeping" status={<ServicePill status={bookkeepingStatus(g)} />}>
        <KeyValue
          items={[
            { label: 'console.bookkeeping.software', value: g.bookkeeping?.software ? t(`console.software.${g.bookkeeping.software}`) : null },
            { label: 'console.bookkeeping.accountantEmail', value: g.bookkeeping?.accountantEmail ? <span dir="ltr">{g.bookkeeping.accountantEmail}</span> : null },
          ]}
        />
      </Card>

      <Card title="console.garages.members" status={<span className={styles.muted}>{g.members.length}</span>}>
        {g.members.length ? (
          <table className={styles.members}>
            <thead>
              <tr>
                <th>{t('console.garages.email')}</th>
                <th>{t('console.garages.role')}</th>
                <th>{t('console.garages.lastSignInCol')}</th>
              </tr>
            </thead>
            <tbody>
              {g.members.map((m) => (
                <tr key={m.email}>
                  <td dir="ltr" className={styles.email}>{m.email}</td>
                  <td>{m.role === 'admin' ? <Pill tone="ok">{t('console.roles.admin')}</Pill> : t('console.roles.member')}</td>
                  <td>{m.lastSignIn ? formatDate(m.lastSignIn) : <span className={styles.muted}>{t('console.garages.never')}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className={styles.muted}>{t('console.garages.noMembers')}</p>}
      </Card>

      <Card title="console.garages.letterhead">
        {letterhead.length ? <KeyValue items={letterhead} /> : <p className={styles.muted}>{t('console.garages.noLetterhead')}</p>}
      </Card>
    </Modal>,
    document.body,
  );
}
