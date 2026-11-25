import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { EnvironmentInfo, FunctionDriftReport } from '../../api/types';
import { Button, EnvName, LoadState, Note, Pill, Section } from '../../components';
import { useLoad } from '../../hooks/useLoad';
import styles from './FunctionsPage.module.css';

/** The slow check: download what runs and compare it byte for byte with git.
 *  Only on request — it is one download per function. */
export function DriftSection({ env }: { env: EnvironmentInfo }) {
  const { t } = useTranslation();
  const [asked, setAsked] = useState(false);
  const load = useLoad<FunctionDriftReport>(asked ? `/api/functions/drift?env=${env.id}` : null);

  return (
    <Section
      title={<>{<EnvName env={env} />} {t('console.functions.versus', { ref: env.gitRef ?? '' })}</>}
      aside={t('console.functions.driftHint')}
      actions={
        <Button size="sm" onClick={() => (asked ? load.reload() : setAsked(true))} disabled={load.loading}>
          {load.loading ? t('console.functions.checking') : t(asked ? 'console.functions.recheck' : 'console.functions.check')}
        </Button>
      }
    >
      <LoadState load={load}>
        {(d) => {
          const off = d.results.filter((r) => !r.deployed || r.noSource || r.error || r.sameAsRef === false);
          if (!off.length) return <Pill tone="ok">{t('console.functions.allSame', { ref: d.gitRef })}</Pill>;
          return (
            <>
              <ul className={styles.drift}>
                {off.map((r) => (
                  <li key={r.name}>
                    <code>{r.name}</code>{' '}
                    {!r.deployed && <Pill tone="danger">{t('console.functions.notDeployed')}</Pill>}
                    {r.noSource && <Pill tone="warn">{t('console.functions.liveNoSource')}</Pill>}
                    {r.error && <Pill tone="danger" title={r.error}>{t('console.functions.downloadFailed')}</Pill>}
                    {r.sameAsRef === false && (
                      <>
                        <Pill tone="warn">{t('console.functions.differsFrom', { ref: d.gitRef })}</Pill>
                        {r.matchesTree && <span className={styles.muted}> {t('console.functions.matchesTree')}</span>}
                        <span className={styles.files}> {r.offRef?.join(', ')}</span>
                      </>
                    )}
                  </li>
                ))}
              </ul>
              <Note>{t('console.functions.deployWith', { ref: d.gitRef })}</Note>
              <pre className={styles.cmd}>npm run functions:push{env.id === 'production' ? ':prod' : ''} &lt;name&gt;</pre>
            </>
          );
        }}
      </LoadState>
    </Section>
  );
}
