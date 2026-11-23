import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { EnvironmentInfo, FunctionRow, FunctionsOverview } from '../../api/types';
import { Button, LoadState, Note, Pill, Section, Table, type Column } from '../../components';
import { useLoad } from '../../hooks/useLoad';
import { formatDate } from '../../lib/format';
import { DriftSection } from './DriftSection';
import styles from './FunctionsPage.module.css';

export function FunctionsPage({ envs }: { envs: readonly EnvironmentInfo[] }) {
  const { t } = useTranslation();
  const load = useLoad<FunctionsOverview>('/api/functions');
  const remote = useMemo(() => envs.filter((e) => e.ref), [envs]);

  const columns = useMemo<Column<FunctionRow>[]>(() => [
    {
      key: 'name',
      header: 'console.functions.name',
      render: (r) => (
        <>
          <code>{r.name}</code>
          {!r.inRepo && <> <Pill tone="warn">{t('console.functions.noSource')}</Pill></>}
        </>
      ),
      sortValue: (r) => r.name,
    },
    ...remote.map((env): Column<FunctionRow> => ({
      key: env.id,
      renderHeader: () => env.label,
      render: (r) => {
        const d = r.deployed[env.id];
        if (d === undefined) return <span className={styles.muted}>{t('console.common.unknown')}</span>;
        if (d === null) return <Pill tone="danger">{t('console.functions.notDeployed')}</Pill>;
        return (
          <span>
            v{d.version} · {formatDate(d.updatedAt)} <code className={styles.muted}>{d.hash?.slice(0, 8)}</code>
          </span>
        );
      },
    })),
    {
      key: 'same',
      header: 'console.functions.between',
      render: (r) =>
        r.sameEverywhere === true ? <Pill tone="ok">{t('console.functions.same')}</Pill>
          : r.sameEverywhere === false ? <Pill tone="warn">{t('console.functions.different')}</Pill>
            : <span className={styles.muted}>—</span>,
    },
  ], [remote, t]);

  return (
    <>
      <Section
        title="console.functions.title"
        aside={t('console.functions.byHash')}
        actions={
          <Button size="sm" onClick={load.reload} disabled={load.loading}>
            {load.loading ? t('console.common.loading') : t('console.common.reload')}
          </Button>
        }
      >
        <LoadState load={load}>
          {(f) => (
            <>
              {Object.entries(f.errors).map(([id, message]) => (
                <Note key={id} tone="danger">
                  {t('console.functions.unreadable', { env: envs.find((e) => e.id === id)?.label ?? id, message })}
                </Note>
              ))}
              <Table columns={columns} rows={f.rows} rowKey={(r) => r.name} className={styles.table} />
            </>
          )}
        </LoadState>
      </Section>

      {remote.map((env) => <DriftSection key={env.id} env={env} />)}
    </>
  );
}
