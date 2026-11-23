import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { EnvironmentInfo, GarageOverview, GaragesReport } from '../../api/types';
import { EnvSection, LoadState, Note, Pill, Table, type Column } from '../../components';
import { useLoad } from '../../hooks/useLoad';
import { formatDate } from '../../lib/format';
import { GarageDetails } from './GarageDetails';
import styles from './GaragesPage.module.css';
import { ServicePill } from './ServicePill';
import { bookkeepingStatus, invoicingStatus, paymentsStatus } from './serviceStatus';

export function GaragesPage({ envs }: { envs: readonly EnvironmentInfo[] }) {
  return (
    <>
      {envs.map((env) => <EnvGarages key={env.id} env={env} />)}
    </>
  );
}

function EnvGarages({ env }: { env: EnvironmentInfo }) {
  const { t } = useTranslation();
  const load = useLoad<GaragesReport>(`/api/garages?env=${env.id}`);
  const [open, setOpen] = useState<string | null>(null);

  const columns = useMemo<Column<GarageOverview>[]>(() => [
    { key: 'name', header: 'console.garages.name', render: (g) => <strong>{g.name}</strong>, sortValue: (g) => g.name },
    { key: 'created', header: 'console.garages.created', render: (g) => formatDate(g.createdAt), sortValue: (g) => g.createdAt },
    {
      key: 'admins',
      header: 'console.garages.admins',
      render: (g) => {
        const admins = g.members.filter((m) => m.role === 'admin');
        return admins.length
          ? <span dir="ltr">{admins.map((m) => m.email).join(', ')}</span>
          : <Pill tone="danger">{t('console.garages.noAdmin')}</Pill>;
      },
    },
    { key: 'members', header: 'console.garages.memberCount', render: (g) => g.members.length, sortValue: (g) => g.members.length, align: 'center' },
    { key: 'invoicing', header: 'console.services.invoicing', render: (g) => <ServicePill status={invoicingStatus(g)} /> },
    { key: 'payments', header: 'console.services.payments', render: (g) => <ServicePill status={paymentsStatus(g)} /> },
    { key: 'bookkeeping', header: 'console.services.bookkeeping', render: (g) => <ServicePill status={bookkeepingStatus(g)} /> },
  ], [t]);

  return (
    <EnvSection
      env={env}
      loading={load.loading}
      onReload={load.reload}
      aside={load.data && t('console.garages.count', { count: load.data.garages.length })}
    >
      <LoadState load={load}>
        {(report) => (
          <>
            {report.missingTables.length > 0 && (
              <Note tone="warn">{t('console.garages.missingTables', { tables: report.missingTables.join(', ') })}</Note>
            )}
            <Table
              className={styles.table}
              columns={columns}
              rows={report.garages}
              rowKey={(g) => g.id}
              emptyKey="console.garages.empty"
              onRowClick={(g) => setOpen(open === g.id ? null : g.id)}
              isRowSelected={(g) => g.id === open}
              renderExpanded={(g) => (g.id === open ? <GarageDetails garage={g} /> : null)}
            />
          </>
        )}
      </LoadState>
    </EnvSection>
  );
}
