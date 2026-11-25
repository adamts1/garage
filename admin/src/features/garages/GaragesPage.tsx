import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { EnvId, EnvironmentInfo, GarageOverview, GaragesReport } from '../../api/types';
import {
  Button, CheckboxField, EnvPicker, KpiCard, KpiRow, LoadState, Note, Pill, SearchBar, Section, Table, type Column,
} from '../../components';
import { useLoad, type Load } from '../../hooks/useLoad';
import { formatDate } from '../../lib/format';
import { GarageDetails } from './GarageDetails';
import styles from './GaragesPage.module.css';
import { InvoicingSwitch } from './InvoicingSwitch';
import { ServicePill } from './ServicePill';
import {
  bookkeepingStatus, garageIssues, invoicingStatus, isAutomatedTestGarage, lastActivity, matchesQuery, paymentsStatus,
} from './serviceStatus';

const ENV_KEY = 'admin-console:garages-env';

const savedEnv = (envs: readonly EnvironmentInfo[]): EnvId => {
  const saved = localStorage.getItem(ENV_KEY);
  return envs.find((e) => e.id === saved)?.id ?? envs[0]?.id ?? 'production';
};

/* All three load at once, so the picker can show each one's count; the page
   shows one at a time. */
function useGarageLoads(): Record<EnvId, Load<GaragesReport>> {
  return {
    production: useLoad<GaragesReport>('/api/garages?env=production'),
    staging: useLoad<GaragesReport>('/api/garages?env=staging'),
    local: useLoad<GaragesReport>('/api/garages?env=local'),
  };
}

export function GaragesPage({ envs }: { envs: readonly EnvironmentInfo[] }) {
  const { t } = useTranslation();
  const loads = useGarageLoads();
  const [envId, setEnvId] = useState<EnvId>(() => savedEnv(envs));
  const [query, setQuery] = useState('');
  const [showTests, setShowTests] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const env = envs.find((e) => e.id === envId) ?? envs[0];
  const load = loads[envId];
  const all = load.data?.garages ?? [];
  const tests = all.filter(isAutomatedTestGarage).length;
  const rows = all.filter((g) => (showTests || !isAutomatedTestGarage(g)) && matchesQuery(g, query));
  const open = all.find((g) => g.id === openId) ?? null;

  const select = (id: EnvId) => {
    localStorage.setItem(ENV_KEY, id);
    setEnvId(id);
    setOpenId(null);
  };

  const counts = Object.fromEntries(envs.map((e) => [e.id, loads[e.id].data?.garages.filter((g) => !isAutomatedTestGarage(g)).length ?? null]));

  const columns = useMemo<Column<GarageOverview>[]>(() => [
    {
      key: 'name',
      header: 'console.garages.name',
      sortValue: (g) => g.name,
      render: (g) => {
        const issues = garageIssues(g);
        const worst = issues.some((i) => i.tone === 'danger') ? 'danger' : 'warn';
        return (
          <div className={styles.nameCell}>
            <span className={styles.name}>
              {g.name}
              {issues.length > 0 && (
                <Pill tone={worst} title={issues.map((i) => t(i.key)).join('\n')}>
                  {t('console.issues.count', { count: issues.length })}
                </Pill>
              )}
            </span>
            <span className={styles.sub}>
              {t('console.garages.createdOn', { date: formatDate(g.createdAt) })}
              {' · '}
              {t('console.garages.usersCount', { count: g.members.length })}
            </span>
          </div>
        );
      },
    },
    {
      key: 'admin',
      header: 'console.garages.admin',
      render: (g) => {
        const admins = g.members.filter((m) => m.role === 'admin');
        if (!admins.length) return <Pill tone="danger">{t('console.garages.noAdmin')}</Pill>;
        return (
          <span className={styles.admin}>
            <span dir="ltr" className={styles.email}>{admins[0]?.email}</span>
            {admins.length > 1 && <span className={styles.more} dir="ltr" title={admins.slice(1).map((m) => m.email).join('\n')}>+{admins.length - 1}</span>}
          </span>
        );
      },
    },
    {
      key: 'activity',
      header: 'console.garages.lastActivity',
      sortValue: (g) => lastActivity(g) ?? '',
      render: (g) => {
        const last = lastActivity(g);
        return last ? formatDate(last) : <span className={styles.muted}>{t('console.garages.never')}</span>;
      },
    },
    {
      key: 'invoicing',
      header: 'console.services.invoicing',
      render: (g) => (g.invoicing?.credentials
        ? <InvoicingSwitch env={envId} garage={g} onChanged={load.reload} showLabel />
        : <ServicePill status={invoicingStatus(g)} />),
    },
    { key: 'payments', header: 'console.services.payments', render: (g) => <ServicePill status={paymentsStatus(g)} /> },
    { key: 'bookkeeping', header: 'console.services.bookkeeping', render: (g) => <ServicePill status={bookkeepingStatus(g)} /> },
    { key: 'open', header: '', render: () => <span className={styles.chevron} aria-hidden="true">‹</span> },
  ], [t, envId, load.reload]);

  const real = all.filter((g) => !isAutomatedTestGarage(g));
  const kpi = {
    garages: real.length,
    invoicing: real.filter((g) => g.invoicing?.credentials && g.invoicing.active).length,
    payments: real.filter((g) => g.payments?.credentials && g.payments.active && !g.payments.authFailedAt).length,
    attention: real.filter((g) => garageIssues(g).length > 0).length,
  };

  return (
    <>
      <div className={styles.toolbar}>
        <EnvPicker envs={envs} selected={envId} onSelect={select} counts={counts} label={t('console.garages.envPicker')} />
        <span className={styles.ref} dir="ltr">{env?.ref ?? 'localhost'}</span>
        <Button size="sm" onClick={load.reload} disabled={load.loading}>
          {load.loading ? t('console.common.loading') : t('console.common.reload')}
        </Button>
      </div>

      <LoadState load={load}>
        {(report) => (
          <>
            {report.missingTables.length > 0 && (
              <Note tone="warn">{t('console.garages.missingTables', { tables: report.missingTables.join(', ') })}</Note>
            )}

            <KpiRow>
              <KpiCard label="console.kpi.garages" value={String(kpi.garages)} tone="navy"
                sub={tests ? 'console.kpi.plusTests' : undefined} subValues={{ count: tests }} />
              <KpiCard label="console.kpi.invoicing" value={`${kpi.invoicing}/${kpi.garages}`} tone="ok" sub="console.kpi.invoicingSub" />
              <KpiCard label="console.kpi.payments" value={`${kpi.payments}/${kpi.garages}`} tone="slate" sub="console.kpi.paymentsSub" />
              <KpiCard label="console.kpi.attention" value={String(kpi.attention)} tone={kpi.attention ? 'warn' : 'ok'} sub="console.kpi.attentionSub" />
            </KpiRow>

            <Section
              title="console.garages.listTitle"
              aside={t('console.garages.shown', { shown: rows.length, total: showTests ? all.length : all.length - tests })}
            >
              <SearchBar value={query} onChange={setQuery} placeholder="console.garages.search">
                {tests > 0 && (
                  <div className={styles.testsToggle}>
                    <CheckboxField
                      label="console.garages.showTests"
                      labelValues={{ count: tests }}
                      checked={showTests}
                      onChange={(e) => setShowTests(e.target.checked)}
                    />
                  </div>
                )}
              </SearchBar>
              <Table
                className={styles.table}
                columns={columns}
                rows={rows}
                rowKey={(g) => g.id}
                empty={query.trim() ? <p className={styles.empty}>{t('console.garages.noMatch', { query: query.trim() })}</p> : undefined}
                emptyKey="console.garages.empty"
                onRowClick={(g) => setOpenId(g.id)}
                isRowSelected={(g) => g.id === openId}
                defaultSort={{ key: 'name', dir: 1 }}
              />
            </Section>

            {open && env && (
              <GarageDetails garage={open} env={env} onChanged={load.reload} onClose={() => setOpenId(null)} />
            )}
          </>
        )}
      </LoadState>
    </>
  );
}
