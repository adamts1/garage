import { useTranslation } from 'react-i18next';
import type { EnvironmentInfo, Migration, MigrationStatus } from '../../api/types';
import { EnvSection, LoadState, Note, Pill, type PillTone } from '../../components';
import { useLoad } from '../../hooks/useLoad';
import { formatVersion } from '../../lib/format';
import styles from './MigrationsPage.module.css';

export function MigrationsPage({ envs }: { envs: readonly EnvironmentInfo[] }) {
  const { t } = useTranslation();
  return (
    <>
      <Note>{t('console.migrations.intro')}</Note>
      <pre className={styles.cmd}>git fetch origin</pre>
      {envs.map((env) => <EnvMigrations key={env.id} env={env} />)}
    </>
  );
}

function MigrationGroup({ tone, label, values, items }: {
  tone: PillTone;
  label: string;
  values?: Record<string, string>;
  items: Migration[];
}) {
  const { t } = useTranslation();
  if (!items.length) return null;
  return (
    <div className={styles.group}>
      <Pill tone={tone}>{t(label, values)}</Pill>
      <ul className={styles.list}>
        {items.map((m) => (
          <li key={m.version}>
            <code>{m.version}</code> <span className={styles.muted}>({formatVersion(m.version)})</span> {m.name}
          </li>
        ))}
      </ul>
    </div>
  );
}

function EnvMigrations({ env }: { env: EnvironmentInfo }) {
  const { t } = useTranslation();
  const load = useLoad<MigrationStatus>(`/api/migrations?env=${env.id}`);
  const m = load.data;
  const clean = m && !m.pendingFromBranch.length && !m.pendingFromTree.length && !m.unknown.length;

  return (
    <EnvSection
      env={env}
      loading={load.loading}
      onReload={load.reload}
      aside={m && (
        <>
          {t('console.migrations.applied', { count: m.applied.length, last: m.applied[m.applied.length - 1] ?? '—' })}
          {clean && <Pill tone="ok">{t('console.migrations.upToDate')}</Pill>}
        </>
      )}
    >
      <LoadState load={load}>
        {(s) => (
          <>
            {!s.branchKnown && s.gitRef && <Note tone="warn">{t('console.migrations.noBranch', { ref: s.gitRef })}</Note>}
            <MigrationGroup tone="danger" label="console.migrations.pendingFromBranch" values={{ ref: s.gitRef ?? '' }} items={s.pendingFromBranch} />
            <MigrationGroup
              tone="warn"
              label={env.id === 'local' ? 'console.migrations.pendingLocal' : 'console.migrations.pendingFromTree'}
              items={s.pendingFromTree}
            />
            <MigrationGroup tone="danger" label="console.migrations.unknown" items={s.unknown} />
          </>
        )}
      </LoadState>
    </EnvSection>
  );
}
