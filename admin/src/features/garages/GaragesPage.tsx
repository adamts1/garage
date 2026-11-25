import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { EnvId, EnvironmentInfo, GarageOverview, GaragesReport } from '../../api/types';
import {
  Button, EnvPicker, LoadState, Note, Pill, SearchInput, StatCard, StatRow, Table, type Column,
} from '../../components';
import { IconFilter, IconPlus, IconRefresh } from '../../components/icons';
import { useLoad, type Load } from '../../hooks/useLoad';
import { formatDate } from '../../lib/format';
import { goTo } from '../../lib/nav';
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
  const [attentionOnly, setAttentionOnly] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const env = envs.find((e) => e.id === envId) ?? envs[0];
  const load = loads[envId];
  const all = load.data?.garages ?? [];
  const tests = all.filter(isAutomatedTestGarage).length;
  const rows = all.filter((g) => (showTests || !isAutomatedTestGarage(g))
    && (!attentionOnly || garageIssues(g).length > 0)
    && matchesQuery(g, query));
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
                  {t('console.issues.badge')}
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
      <header className={styles.header}>
        <div className={styles.titleBlock}>
          <h1 className={styles.title}>{t('console.tabs.garages')}</h1>
          <EnvPicker envs={envs} selected={envId} onSelect={select} counts={counts} label={t('console.garages.envPicker')} />
        </div>
        <div className={styles.actions}>
          <Button variant="primary" className={styles.newGarage} onClick={() => goTo('onboard')}>
            <IconPlus /> {t('console.tabs.onboard')}
          </Button>
          <Button onClick={load.reload} disabled={load.loading} title={env?.ref ?? undefined}>
            <IconRefresh /> {load.loading ? t('console.common.loading') : t('console.common.reload')}
          </Button>
        </div>
      </header>

      <LoadState load={load}>
        {(report) => (
          <>
            {report.missingTables.length > 0 && (
              <Note tone="warn">{t('console.garages.missingTables', { tables: report.missingTables.join(', ') })}</Note>
            )}

            <StatRow>
              <StatCard label="console.kpi.garages" value={String(kpi.garages)}
                sub={tests ? 'console.kpi.plusTests' : undefined} subValues={{ count: tests }} />
              <StatCard label="console.kpi.invoicing" value={`${kpi.invoicing}/${kpi.garages}`} tone="ok" sub="console.kpi.invoicingSub" />
              <StatCard label="console.kpi.payments" value={`${kpi.payments}/${kpi.garages}`} sub="console.kpi.paymentsSub" />
              <StatCard label="console.kpi.attention" value={String(kpi.attention)} tone={kpi.attention ? 'attention' : 'plain'} sub="console.kpi.attentionSub" />
            </StatRow>

            <section className={styles.list}>
              <div className={styles.listHead}>
                <h2>{t('console.garages.listTitle')}</h2>
                <div className={styles.filters}>
                  <SearchInput value={query} onChange={setQuery} placeholder="console.garages.search" />
                  <button
                    type="button"
                    className={`${styles.filter} ${attentionOnly ? styles.filterOn : ''}`}
                    aria-pressed={attentionOnly}
                    onClick={() => setAttentionOnly((v) => !v)}
                  >
                    <IconFilter /> {t('console.kpi.attention')}
                  </button>
                  {tests > 0 && (
                    <button
                      type="button"
                      className={`${styles.filter} ${showTests ? styles.filterOn : ''}`}
                      aria-pressed={showTests}
                      onClick={() => setShowTests((v) => !v)}
                    >
                      {t('console.garages.showTests', { count: tests })}
                    </button>
                  )}
                </div>
              </div>
              <Table
                className={styles.table}
                columns={columns}
                rows={rows}
                rowKey={(g) => g.id}
                empty={query.trim() ? <p className={styles.empty}>{t('console.garages.noMatch', { query: query.trim() })}</p> : undefined}
                emptyKey="console.garages.empty"
                onRowClick={(g) => setOpenId(g.id)}
                isRowSelected={(g) => g.id === openId}
                rowClassName={(g) => (garageIssues(g).length ? styles.attentionRow : undefined)}
                defaultSort={{ key: 'name', dir: 1 }}
              />
            </section>

            {open && env && (
              <GarageDetails garage={open} env={env} onChanged={load.reload} onClose={() => setOpenId(null)} />
            )}
          </>
        )}
      </LoadState>
    </>
  );
}
