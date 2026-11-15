import {
  BOOKKEEPING_FILES, bookkeepingExportUrl, garageName, getBookkeepingSettings, isGarageAdmin, listBookkeepingExports,
  requestBookkeepingExport, retryBookkeepingExport, sendBookkeepingExport, setAccountantEmail,
  setBookkeepingSoftware, subscribeToBookkeepingExports,
  type BookkeepingExport, type BookkeepingFile, type BookkeepingSoftware,
} from '@garage/shared';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/Button';
import { Pill, type PillTone } from '../../components/Pill';
import { RowMenu, Table, type Column } from '../../components/Table';
import { IconDoc, IconDownload, IconExport, IconInfo, IconLayers, IconMail } from '../../icons';
import {
  showError, showInfo, showSuccess, useAppDispatch, useBusyRun, useConfirm, usePrompt,
} from '../../store';
import { collectFiles, makeZip, zipName } from './bookkeepingZip';
import { presetRange, type DateRange } from './incomeRollUp';

/* The files the garage's bookkeeper imports — into ריווחית or חשבשבת, set per
 * garage, because the two need different files. Two cards:
 *
 *   "new export"  — the software, the period and which files; then order.
 *   "history"     — every export: send it to the accountant, download it as
 *                   one zip, or see what went wrong.
 *
 * Nothing here builds the files. The accounting provider does, because it holds
 * the chart of accounts: a journal file we generated would be pointing at
 * ledger codes this app has never seen.
 *
 * The provider builds them in the background, so ordering finishes in a second
 * and produces nothing. The files arrive minutes later, announced by a callback
 * to an Edge Function, and the row changes underneath the page. Hence the
 * history list — it is the only place the answer can appear.
 */

/* Whole periods only. A bookkeeping export is filed against a VAT period or a
   month, and "the last 30 days" is not a thing anyone reports on. */
const PRESETS = ['thisMonth', 'lastMonth', 'thisVatPeriod', 'thisYear'] as const;

const SOFTWARES: readonly BookkeepingSoftware[] = ['rivhit', 'hashavshevet'];

/** Left-to-right text (dates, addresses) inside a Hebrew sentence, isolated so
 *  the sentence's direction cannot reorder it. */
const ltr = (text: string) => `⁦${text}⁩`;

/** A send still marked in flight after this long did not finish. Matches
 *  STALE_MINUTES in send-bookkeeping, which closes such a send when the next
 *  one is pressed — so the button must not stay locked by it. */
const STALE_SEND_MS = 10 * 60_000;
const sendInFlight = (r: BookkeepingExport) =>
  r.lastEmail?.status === 'sending' && Date.now() - new Date(r.lastEmail.createdAt).getTime() < STALE_SEND_MS;

const TONE: Record<string, PillTone> = {
  ready: 'ok',
  requested: 'warn',
  error: 'danger',
};

/** Kilobytes, one decimal. Worth showing: an export that comes back nearly
 *  empty is usually a range with nothing in it, and the number says so. */
const size = (bytes: number | null) =>
  bytes == null ? '' : `${(bytes / 1024).toFixed(1)} KB`;

/** The sum of the files that actually arrived, when they are recorded one by
 *  one; otherwise the single total older exports kept. */
const totalBytes = (r: BookkeepingExport): number | null =>
  r.fileSizes ? Object.values(r.fileSizes).reduce((a, b) => a + b, 0) : r.fileBytes;

const ymd = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
};
const dmy = (iso: string) => ymd(iso).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' });
const dateTime = (iso: string) => {
  const d = new Date(iso);
  return `${d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' })}, ${
    d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}`;
};

/** "אוקטובר 2026" for a whole calendar month — which is what most exports are —
 *  and the two dates otherwise. */
export function periodLabel(start: string, end: string): string {
  const s = ymd(start);
  const e = ymd(end);
  const lastOfMonth = new Date(s.getFullYear(), s.getMonth() + 1, 0).getDate();
  if (s.getDate() === 1 && e.getFullYear() === s.getFullYear() && e.getMonth() === s.getMonth()
      && e.getDate() === lastOfMonth) {
    return s.toLocaleDateString('he-IL', { month: 'long', year: 'numeric' });
  }
  return `${dmy(start)} – ${dmy(end)}`;
}

export default function BookkeepingExport() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const run = useBusyRun();
  const confirm = useConfirm();
  const prompt = usePrompt();
  const admin = isGarageAdmin();

  const [rows, setRows] = useState<BookkeepingExport[]>([]);
  /* undefined while loading; null when the garage has none set. */
  const [software, setSoftware] = useState<BookkeepingSoftware | null | undefined>(undefined);
  /* Why the settings could not be read, if they could not. Shown rather than
     left as a selector stuck on "loading" — a page that silently cannot be used
     is the one failure nobody reports. */
  const [settingsError, setSettingsError] = useState<string | null>(null);
  /* Where "send to accountant" goes. */
  const [accountantEmail, setAccountantEmailState] = useState<string | null>(null);
  const [preset, setPreset] = useState<string>('lastMonth');
  const [range, setRange] = useState<DateRange>(() => presetRange('lastMonth', new Date()));
  const [picked, setPicked] = useState<Record<BookkeepingFile, boolean>>({
    'movein.dat': true, 'heshin.dat': true, 'heshin.prm': true,
  });

  const load = useCallback(
    () => listBookkeepingExports().then(setRows).catch((e) => dispatch(showError(e))),
    [dispatch],
  );

  useEffect(() => {
    getBookkeepingSettings()
      .then((s) => {
        setSoftware(s.software);
        setAccountantEmailState(s.accountantEmail);
        setSettingsError(null);
      })
      .catch((e) => setSettingsError(e instanceof Error ? e.message : String(e)));
  }, []);

  /* The subscription is not a nicety: the row that says "being prepared" is
     changed minutes later by the provider's callback, not by this browser. */
  useEffect(() => {
    void load();
    return subscribeToBookkeepingExports(() => void load());
  }, [load]);

  /* The setting decides which files every later export is built from, so a
     change is confirmed — and says what it will change. */
  const changeSoftware = async (next: BookkeepingSoftware) => {
    if (next === software) return;
    const ok = await confirm({
      bodyKey: 'bookkeeping.confirmSoftware',
      values: { software: t(`bookkeeping.software.${next}`) },
    });
    if (!ok) return;
    try {
      setSoftware(await run('busy.savingSoftware', () => setBookkeepingSoftware(next)));
      dispatch(showSuccess('bookkeeping.softwareSaved'));
    } catch (e) {
      dispatch(showError(e));
    }
  };

  /* Admin only — whoever sets it decides where the garage's books are sent. */
  const editAccountantEmail = async () => {
    const typed = await prompt({
      titleKey: 'bookkeeping.accountantEmailTitle',
      labelKey: 'bookkeeping.accountantEmailLabel',
      defaultValue: accountantEmail ?? '',
    });
    if (typed === null) return;
    try {
      const saved = await run('busy.savingAccountantEmail', () => setAccountantEmail(typed));
      setAccountantEmailState(saved);
      dispatch(showSuccess('bookkeeping.accountantEmailSaved'));
    } catch (e) {
      dispatch(showError(e));
    }
  };

  const pick = (id: string) => {
    setPreset(id);
    setRange(presetRange(id, new Date()));
  };
  const edit = (patch: Partial<DateRange>) => {
    setPreset('');
    setRange((prev) => ({ ...prev, ...patch }));
  };

  /* Both ends are required. An open-ended bookkeeping export is either
     everything the garage has ever done or nothing at all. */
  const chosen = BOOKKEEPING_FILES.filter((f) => picked[f]);
  const valid = Boolean(software) && Boolean(range.from && range.to) && range.to >= range.from && chosen.length > 0;

  const order = async () => {
    if (!valid) return;
    try {
      await run('busy.orderingExport', () => requestBookkeepingExport({
        startDate: range.from,
        endDate: range.to,
        files: chosen,
      }));
      /* Says what did NOT happen: the button finished and there is no file yet. */
      dispatch(showInfo('bookkeeping.ordered'));
      void load();
    } catch (e) {
      dispatch(showError(e));
    }
  };

  /* The callback ran ahead of the file. Nothing is re-ordered — the same file is
     fetched again from the link the provider already gave. */
  const retry = async (row: BookkeepingExport) => {
    try {
      await run('busy.fetchingExport', () => retryBookkeepingExport(row.id));
      void load();
    } catch (e) {
      dispatch(showError(e));
    }
  };

  /* Every file of the export in one zip, named for the garage, the software
     and the period. See bookkeepingZip.ts for the checks each file passes. */
  const downloadZip = async (row: BookkeepingExport) => {
    try {
      const zip = await run('busy.zippingExport', async () => {
        const files = await collectFiles(row, async (file) => {
          const res = await fetch(await bookkeepingExportUrl(row.id, file));
          if (!res.ok) throw new Error(`${file}: download failed (${res.status})`);
          return new Uint8Array(await res.arrayBuffer());
        });
        return makeZip(files);
      });
      const label = row.software ? t(`bookkeeping.software.${row.software}`) : null;
      const url = URL.createObjectURL(new Blob([zip as BlobPart], { type: 'application/zip' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = zipName(garageName(), label, row);
      document.body.appendChild(a);
      a.click();
      a.remove();
      /* Not revoked at once: some browsers start the download after click(). */
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      dispatch(showSuccess('bookkeeping.downloading'));
    } catch (e) {
      dispatch(showError(e));
    }
  };

  const downloadOne = async (row: BookkeepingExport, file: BookkeepingFile) => {
    try {
      /* Straight to a two-minute signed URL; the bucket is private. */
      window.location.href = await bookkeepingExportUrl(row.id, file);
      dispatch(showSuccess('bookkeeping.downloading'));
    } catch (e) {
      dispatch(showError(e));
    }
  };

  /* Sent from the server; this only names the export. The confirmation says
     exactly where it is going — and, the second time, that it already went. */
  const send = async (row: BookkeepingExport) => {
    if (!accountantEmail) return;
    const values = {
      to: ltr(accountantEmail),
      range: ltr(periodLabel(row.startDate, row.endDate)),
      software: row.software ? t(`bookkeeping.software.${row.software}`) : '',
      when: row.lastEmail?.sentAt ? ltr(dateTime(row.lastEmail.sentAt)) : '',
    };
    const already = row.lastEmail?.status === 'sent';
    const ok = await confirm({ bodyKey: already ? 'bookkeeping.confirmResend' : 'bookkeeping.confirmSend', values });
    if (!ok) return;
    try {
      await run('busy.sendingExport', () => sendBookkeepingExport(row.id));
      dispatch(showSuccess('bookkeeping.sent'));
    } catch (e) {
      dispatch(showError(e));
    } finally {
      /* Either way the history changed: a sent row, or an error row saying why. */
      void load();
    }
  };

  /* The details that do not earn a column: the files by name, and the whole
     story of the last send. */
  const showDetails = (row: BookkeepingExport) => {
    const last = row.lastEmail;
    const lines = [
      t('bookkeeping.details.files', { files: ltr(row.files.join(', ')) }),
      last
        ? t(`bookkeeping.details.email.${last.status}`, {
          to: ltr(last.to),
          when: ltr(dateTime(last.sentAt ?? last.createdAt)),
          error: last.error ?? '',
        })
        : t('bookkeeping.details.neverSent'),
      row.error ? t('bookkeeping.details.error', { error: row.error }) : '',
    ].filter(Boolean);
    void confirm({ titleKey: 'bookkeeping.details.title', bodyKey: 'bookkeeping.details.body', values: { text: lines.join('\n') } });
  };

  const columns: Column<BookkeepingExport>[] = [
    {
      key: 'period',
      header: 'bookkeeping.fields.period',
      sortValue: (r) => r.startDate,
      render: (r) => {
        const last = r.lastEmail;
        return (
          <div className="bkx-period">
            <span className="bkx-period-main">{periodLabel(r.startDate, r.endDate)}</span>
            {last?.status === 'sent' && (
              <span className="bkx-sent">
                {t('bookkeeping.sentShort')} · <span dir="ltr">{dateTime(last.sentAt ?? last.createdAt)}</span>
              </span>
            )}
            {sendInFlight(r) && <span className="bkx-sub">{t('bookkeeping.sending')}</span>}
            {last?.status === 'error' && <span className="bkx-send-error">{t('bookkeeping.sendFailedShort')}</span>}
          </div>
        );
      },
    },
    {
      key: 'software',
      header: 'bookkeeping.fields.softwareShort',
      render: (r) => (r.software ? t(`bookkeeping.software.${r.software}`) : '-'),
    },
    {
      key: 'files',
      header: 'bookkeeping.fields.files',
      sortValue: (r) => totalBytes(r) ?? 0,
      render: (r) => (
        <div className="bkx-files" title={r.files.join(', ')}>
          <IconDoc />
          <div>
            <div>{r.files.length === 1 ? t('bookkeeping.fileCountOne') : t('bookkeeping.fileCount', { count: r.files.length })}</div>
            <div className="bkx-sub" dir="ltr">{size(totalBytes(r))}</div>
          </div>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'bookkeeping.fields.status',
      sortValue: (r) => r.status,
      render: (r) => (
        <Pill tone={TONE[r.status] ?? 'warn'}>{t(`bookkeeping.status.${r.status}`)}</Pill>
      ),
    },
    {
      key: 'created',
      header: 'bookkeeping.fields.created',
      sortValue: (r) => r.createdAt,
      render: (r) => <span dir="ltr">{dateTime(r.createdAt)}</span>,
    },
    {
      key: 'actions',
      header: 'bookkeeping.fields.actions',
      render: (r) => {
        const menu = (
          <RowMenu items={[
            { label: 'bookkeeping.details.open', onSelect: () => showDetails(r) },
            /* One file on its own, for whoever needs just that one. */
            ...r.files.map((f) => ({
              label: `bookkeeping.downloadFile.${f.replace('.', '_')}`,
              onSelect: () => void downloadOne(r, f),
              hidden: r.status !== 'ready',
            })),
          ]} />
        );
        if (r.status === 'ready') {
          const last = r.lastEmail;
          return (
            <div className="bkx-actions">
              <Button
                variant="primary"
                disabled={!accountantEmail || sendInFlight(r)}
                title={accountantEmail ? undefined : t('bookkeeping.noAccountantEmail')}
                onClick={() => void send(r)}
              >
                <IconMail /> {t(last?.status === 'sent' ? 'bookkeeping.resend' : 'bookkeeping.send')}
              </Button>
              {/* On a narrow screen only the icon shows; the title and the
                  accessible name still say what it is. */}
              <Button
                onClick={() => void downloadZip(r)}
                title={t('bookkeeping.downloadZip')}
                aria-label={t('bookkeeping.downloadZip')}
              >
                <IconDownload /> <span className="bkx-narrow-hide">{t('bookkeeping.downloadZip')}</span>
              </Button>
              {menu}
            </div>
          );
        }
        /* The provider's own words: a failed export is something somebody has
           to act on, and "something went wrong" is not actionable. */
        if (r.status === 'error') {
          return (
            <div className="bkx-actions">
              {/* dir=auto: the provider's words are usually English, and in a
                  right-to-left cell an ellipsis would eat their beginning. */}
              <span className="bkx-send-error bkx-error-text" dir="auto" title={r.error ?? ''}>{r.error ?? '-'}</span>
              {menu}
            </div>
          );
        }
        /* An export whose callback has come and gone is waiting on one more
           attempt; before that there is nothing to retry. `error` tells them
           apart: it is only set once an attempt has actually been made. */
        return (
          <div className="bkx-actions">
            {r.error
              ? <Button onClick={() => void retry(r)}>{t('bookkeeping.retry')}</Button>
              : <span className="bkx-sub">{t('bookkeeping.preparing')}</span>}
            {menu}
          </div>
        );
      },
    },
  ];

  return (
    <div className="bkx">
      {/* ---------------------------------------------------------- new export */}
      <section className="card bkx-card">
        <header className="bkx-card-head">
          <span className="bkx-card-icon"><IconExport /></span>
          <h3>{t('bookkeeping.newTitle')}</h3>
        </header>

        <div className="bkx-fields">
          <label className="bkx-field">
            <span>{t('bookkeeping.fields.software')}</span>
            {/* Which accounting system the files are for. First, because the
                files are built differently for each and a wrong one imports
                without complaint. Only an admin changes it. */}
            <select
              className={software === null || settingsError ? 'bkx-missing' : ''}
              value={software ?? ''}
              disabled={!admin || software === undefined}
              title={admin ? undefined : t('bookkeeping.adminOnly')}
              onChange={(e) => void changeSoftware(e.target.value as BookkeepingSoftware)}
            >
              {!software && <option value="" disabled>{t('bookkeeping.chooseSoftware')}</option>}
              {SOFTWARES.map((s) => (
                <option key={s} value={s}>{t(`bookkeeping.software.${s}`)}</option>
              ))}
            </select>
          </label>

          <label className="bkx-field">
            <span>{t('reports.income.filters.period')}</span>
            <select value={preset} onChange={(e) => pick(e.target.value)}>
              {preset === '' && <option value="">{t('reports.income.periods.custom')}</option>}
              {PRESETS.map((p) => (
                <option key={p} value={p}>{t(`reports.income.periods.${p}`)}</option>
              ))}
            </select>
          </label>

          <label className="bkx-field">
            <span>{t('reports.income.filters.from')}</span>
            <input type="date" value={range.from} onChange={(e) => edit({ from: e.target.value })} />
          </label>

          <label className="bkx-field">
            <span>{t('reports.income.filters.to')}</span>
            <input type="date" value={range.to} onChange={(e) => edit({ to: e.target.value })} />
          </label>
        </div>

        {(software === null || settingsError) && (
          <p className="bkx-warning">
            {settingsError
              ? t('bookkeeping.softwareLoadFailed', { error: settingsError })
              : t(admin ? 'bookkeeping.noSoftwareAdmin' : 'bookkeeping.noSoftware')}
          </p>
        )}

        <div className="bkx-tiles" role="group" aria-label={t('bookkeeping.include')}>
          {BOOKKEEPING_FILES.map((f) => (
            <label key={f} className={`bkx-tile${picked[f] ? ' on' : ''}`}>
              <input
                type="checkbox"
                checked={picked[f]}
                onChange={(e) => setPicked((prev) => ({ ...prev, [f]: e.target.checked }))}
              />
              <span className="bkx-tile-text">
                <strong>{t(`bookkeeping.files.${f.replace('.', '_')}`)}</strong>
                <span dir="ltr">{f}</span>
              </span>
            </label>
          ))}
        </div>

        <footer className="bkx-card-foot">
          <span className="bkx-hint"><IconInfo /> {t('bookkeeping.explainer')}</span>
          <Button variant="primary" disabled={!valid} onClick={() => void order()}>
            <IconExport /> {t('bookkeeping.order')}
          </Button>
        </footer>
      </section>

      {/* ---------------------------------------------------------- history */}
      <section className="card bkx-card">
        <header className="bkx-card-head">
          <span className="bkx-card-icon"><IconLayers /></span>
          <div>
            <h3>{t('bookkeeping.historyTitle')}</h3>
            <p className="bkx-sub">{t('bookkeeping.historySubtitle')}</p>
          </div>
          {/* Where "send" goes. Not in the new-export form, because it is not
              part of any one export — it is the garage's, and set once. */}
          <div className="bkx-recipient">
            <IconMail />
            <span>{t('bookkeeping.recipient')}</span>
            {accountantEmail
              ? <strong dir="ltr">{accountantEmail}</strong>
              : <strong className="bkx-send-error">{t('bookkeeping.notSet')}</strong>}
            {admin && (
              <button type="button" className="bkx-link" onClick={() => void editAccountantEmail()}>
                {t(accountantEmail ? 'bookkeeping.editEmail' : 'bookkeeping.setEmail')}
              </button>
            )}
          </div>
        </header>

        <Table
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          emptyKey="bookkeeping.none"
        />
      </section>
    </div>
  );
}
