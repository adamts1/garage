import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { MobileBuildRow, MobileStatus, MobileVerdict } from '../../api/types';
import { Button, LoadState, Note, Pill, Section, Table, type Column, type PillTone } from '../../components';
import { useLoad } from '../../hooks/useLoad';
import { formatDate } from '../../lib/format';
import styles from './MobilePage.module.css';

const VERDICT_TONE: Record<MobileVerdict, PillTone> = {
  current: 'ok',
  behind: 'warn',
  'off-main': 'warn',
  'unknown-commit': 'neutral',
  'never-built': 'danger',
};

const rowKey = (r: MobileBuildRow) => `${r.platform}/${r.profile}`;

/** What was BUILT for each platform and profile, never what is LIVE — EAS does
 *  not know what Apple approved or which Play track a file is on. Read-only:
 *  building stays with release.sh. */
export function MobilePage() {
  const { t } = useTranslation();
  const load = useLoad<MobileStatus>('/api/mobile');
  const [open, setOpen] = useState<string | null>(null);

  const columns = useMemo<Column<MobileBuildRow>[]>(() => [
    { key: 'platform', header: 'console.mobile.platform', render: (r) => t(`console.mobile.platforms.${r.platform}`) },
    { key: 'profile', header: 'console.mobile.profile', render: (r) => <code>{r.profile}</code> },
    {
      key: 'version',
      header: 'console.mobile.version',
      render: (r) => (r.build ? <span dir="ltr">{r.build.appVersion ?? '—'} ({r.build.buildNumber ?? '—'})</span> : '—'),
    },
    { key: 'built', header: 'console.mobile.built', render: (r) => formatDate(r.build?.completedAt) },
    { key: 'commit', header: 'console.mobile.commit', render: (r) => <code>{r.build?.commit ?? '—'}</code> },
    {
      key: 'verdict',
      header: 'console.mobile.state',
      render: (r) => (
        <>
          <Pill tone={VERDICT_TONE[r.verdict]}>
            {t(`console.mobile.verdicts.${r.verdict}`, { bundled: r.behind?.bundled ?? 0, total: r.behind?.total ?? 0 })}
          </Pill>
          {r.laterAttempt && (
            <div className={styles.muted}>
              {t('console.mobile.laterAttempt', { status: r.laterAttempt.status.toLowerCase(), date: formatDate(r.laterAttempt.createdAt) })}
            </div>
          )}
        </>
      ),
    },
    {
      key: 'artifact',
      header: 'console.mobile.artifact',
      render: (r) =>
        r.build?.artifactUrl ? (
          <a href={r.build.artifactUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
            {t('console.mobile.download')}
          </a>
        ) : '—',
    },
  ], [t]);

  return (
    <Section
      title="console.mobile.title"
      aside={load.data && t('console.mobile.base', { base: load.data.base, commit: load.data.baseCommit })}
      actions={
        <Button size="sm" onClick={load.reload} disabled={load.loading}>
          {load.loading ? t('console.common.loading') : t('console.common.reload')}
        </Button>
      }
    >
      <Note>{t('console.mobile.builtNotLive')}</Note>
      <LoadState load={load}>
        {(s) => (
          <Table
            className={styles.table}
            columns={columns}
            rows={s.rows}
            rowKey={rowKey}
            onRowClick={(r) => setOpen(open === rowKey(r) ? null : rowKey(r))}
            renderExpanded={(r) =>
              rowKey(r) === open && r.behind?.log.length ? (
                <div className={styles.log}>
                  <strong>{t('console.mobile.missing')}</strong>
                  <ul>
                    {r.behind.log.map((line) => <li key={line} dir="ltr">{line}</li>)}
                  </ul>
                </div>
              ) : null}
          />
        )}
      </LoadState>
      <Note>{t('console.mobile.howToBuild')}</Note>
      <pre className={styles.cmd}>{[
        'cd mobile',
        'npm run testflight:staging      # iOS staging → TestFlight',
        'npm run build:staging:android   # Android staging .apk',
        'npm run testflight              # iOS production → TestFlight',
        'npm run build:prod:android      # Android production .aab',
      ].join('\n')}</pre>
    </Section>
  );
}
