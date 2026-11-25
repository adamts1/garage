import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { get, post } from '../../api/client';
import type { EnvironmentInfo, MigrationPushPlan, MigrationPushResult, MigrationSource } from '../../api/types';
import { Button, ConfirmDialog, Note } from '../../components';
import { formatVersion } from '../../lib/format';
import styles from './MigrationsPage.module.css';

/** Which sources an environment offers — the same rule ops enforces
 *  (pushSources): production only from its branch, local only from the tree. */
const sourcesFor = (env: EnvironmentInfo): MigrationSource[] =>
  env.id === 'production' ? ['branch'] : env.gitRef ? ['branch', 'tree'] : ['tree'];

/** Applying migrations to one environment: a dry run, its list, then the push
 *  of exactly that list after a confirmation. */
export function MigrationPush({ env, onPushed }: { env: EnvironmentInfo; onPushed: () => void }) {
  const { t } = useTranslation();
  const sources = sourcesFor(env);
  const [source, setSource] = useState<MigrationSource>(sources[0] ?? 'tree');
  const [plan, setPlan] = useState<MigrationPushPlan | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState<MigrationPushResult | null>(null);

  const check = async (from: MigrationSource = source) => {
    setChecking(true);
    setError(null);
    setPlan(null);
    setDone(null);
    try {
      setPlan(await get<MigrationPushPlan>(`/api/migrations/plan?env=${env.id}&source=${from}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setChecking(false);
    }
  };

  /** The plan's source as a person reads it: the ref, or "your files". */
  const planSource = (p: MigrationPushPlan) => (p.source === 'tree' ? t('console.push.treeName') : p.sourceLabel);
  const sourceLabel = (s: MigrationSource) =>
    s === 'branch' ? t('console.push.fromBranch', { ref: env.gitRef ?? '' }) : t('console.push.fromTree');

  return (
    <div className={styles.push}>
      <div className={styles.pushBar}>
        <strong>{t('console.push.title')}</strong>
        {sources.length > 1 ? (
          <div className={styles.sources} role="radiogroup" aria-label={t('console.push.source')}>
            {sources.map((s) => (
              <label key={s} className={styles.source}>
                <input
                  type="radio"
                  name={`source-${env.id}`}
                  checked={source === s}
                  onChange={() => { setSource(s); setPlan(null); setDone(null); }}
                />
                {sourceLabel(s)}
              </label>
            ))}
          </div>
        ) : <span className={styles.muted}>{sourceLabel(sources[0] ?? 'tree')}</span>}
        <Button size="sm" onClick={() => void check()} disabled={checking}>
          {checking ? t('console.push.checking') : t('console.push.check')}
        </Button>
      </div>

      {source === 'tree' && env.id !== 'local' && <Note tone="warn">{t('console.push.treeWarning')}</Note>}
      {error && <Note tone="danger">{t('console.common.error', { message: error })}</Note>}
      {done && <Note>{t('console.push.done', { count: done.applied.length })}</Note>}

      {plan && !plan.files.length && !done && <Note>{t('console.push.nothing', { source: planSource(plan) })}</Note>}

      {plan && plan.files.length > 0 && (
        <div className={styles.plan}>
          <p className={styles.planHead}>{t('console.push.willApply', { count: plan.files.length, source: planSource(plan) })}</p>
          <ol className={styles.list}>
            {plan.files.map((f) => (
              <li key={f}>
                <code dir="ltr">{f.replace(/\.sql$/, '')}</code> <span className={styles.muted}>({formatVersion(f.slice(0, 14))})</span>
              </li>
            ))}
          </ol>
          {plan.outOfOrder && <Note tone="warn">{t('console.push.outOfOrder')}</Note>}
          <Button variant={env.id === 'production' ? 'danger' : 'primary'} onClick={() => setConfirming(true)}>
            {t('console.push.apply', { count: plan.files.length, env: env.label })}
          </Button>
        </div>
      )}

      {confirming && plan && (
        <ConfirmDialog
          env={env.id}
          title="console.push.confirmTitle"
          titleValues={{ env: env.label }}
          confirmLabel="console.push.apply"
          confirmValues={{ count: plan.files.length, env: env.label }}
          danger={env.id === 'production'}
          onClose={() => setConfirming(false)}
          onConfirm={async (confirmEnv) => {
            const result = await post<MigrationPushResult>('/api/migrations/push', {
              env: env.id, source: plan.source, files: plan.files, confirmEnv,
            });
            setDone(result);
            setPlan(null);
            onPushed();
          }}
        >
          <p>{t('console.push.confirmBody', { count: plan.files.length, source: planSource(plan) })}</p>
          <ol className={styles.list}>
            {plan.files.map((f) => <li key={f}><code dir="ltr">{f.replace(/\.sql$/, '')}</code></li>)}
          </ol>
          {plan.outOfOrder && <Note tone="warn">{t('console.push.outOfOrder')}</Note>}
          <Note tone="muted">{t('console.push.noUndo')}</Note>
        </ConfirmDialog>
      )}
    </div>
  );
}
