import {
  bookkeepingExportUrl, listBookkeepingExports, requestBookkeepingExport,
  retryBookkeepingExport, subscribeToBookkeepingExports, type BookkeepingExport,
} from '@garage/shared';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/Button';
import { Filter, FilterBar } from '../../components/FilterBar';
import { Pill, type PillTone } from '../../components/Pill';
import { Table, type Column } from '../../components/Table';
import { IconDoc } from '../../icons';
import { showError, showInfo, showSuccess, useAppDispatch, useBusyRun } from '../../store';
import { presetRange, type DateRange } from './incomeRollUp';

/* The file the garage's bookkeeper imports — movein.dat, for חשבשבת.
 *
 * Nothing here builds it. The accounting provider does, because it holds the
 * chart of accounts: a journal file we generated would be pointing at ledger
 * codes this app has never seen, and every line would land in the wrong place
 * in somebody's books.
 *
 * The provider builds it in the background, so this screen is unlike the other
 * reports in one way that matters: ordering an export finishes in a second and
 * produces nothing. The file arrives minutes later, announced by a callback to
 * an Edge Function, and the row changes underneath the page. Hence the list —
 * it is not history, it is the only place the answer can appear.
 */

/* Whole periods only. A bookkeeping export is filed against a VAT period or a
   month, and "the last 30 days" is not a thing anyone reports on. */
const PRESETS = ['thisMonth', 'lastMonth', 'thisVatPeriod', 'thisYear'] as const;

type Include = 'docs' | 'expenses' | 'clients' | 'suppliers';
const INCLUDES: readonly Include[] = ['docs', 'expenses', 'clients', 'suppliers'];

const TONE: Record<string, PillTone> = {
  ready: 'ok',
  requested: 'warn',
  error: 'danger',
};

/** Kilobytes, one decimal. The size is worth showing because an export that
 *  comes back nearly empty is usually a range with nothing in it rather than a
 *  failure, and the number says so faster than opening the file. */
const size = (bytes: number | null) =>
  bytes == null ? '-' : `${(bytes / 1024).toFixed(1)} KB`;

export default function BookkeepingExport() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const run = useBusyRun();

  const [rows, setRows] = useState<BookkeepingExport[]>([]);
  const [preset, setPreset] = useState<string>('lastMonth');
  const [range, setRange] = useState<DateRange>(() => presetRange('lastMonth', new Date()));
  const [include, setInclude] = useState<Record<Include, boolean>>({
    docs: true, expenses: true, clients: true, suppliers: true,
  });

  const load = useCallback(
    () => listBookkeepingExports().then(setRows).catch((e) => dispatch(showError(e))),
    [dispatch],
  );

  /* The subscription is not a nicety here. The row that says "being prepared"
     is changed minutes later by the provider's callback, not by this browser —
     without this, the only way to see a finished export is to reload. */
  useEffect(() => {
    void load();
    return subscribeToBookkeepingExports(() => void load());
  }, [load]);

  const pick = (id: string) => {
    setPreset(id);
    setRange(presetRange(id, new Date()));
  };
  const edit = (patch: Partial<DateRange>) => {
    setPreset('');
    setRange((prev) => ({ ...prev, ...patch }));
  };

  /* Both ends are required, unlike the other reports. An open-ended bookkeeping
     export is either everything the garage has ever done or nothing at all, and
     neither is what anybody meant to ask for. */
  const chosen = INCLUDES.filter((k) => include[k]);
  const valid = Boolean(range.from && range.to) && range.to >= range.from && chosen.length > 0;

  const order = async () => {
    if (!valid) return;
    try {
      await run('busy.orderingExport', () => requestBookkeepingExport({
        startDate: range.from,
        endDate: range.to,
        docs: include.docs,
        expenses: include.expenses,
        clients: include.clients,
        suppliers: include.suppliers,
      }));
      /* Says what did NOT happen, which is the part that surprises people: the
         button finished and there is still no file. */
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

  const download = async (row: BookkeepingExport) => {
    try {
      const url = await bookkeepingExportUrl(row.id);
      /* Straight to the signed URL. The bucket is private and the link lives
         for two minutes, so there is nothing here worth keeping on screen. */
      window.location.href = url;
      dispatch(showSuccess('bookkeeping.downloading'));
    } catch (e) {
      dispatch(showError(e));
    }
  };

  const columns: Column<BookkeepingExport>[] = [
    {
      key: 'range',
      header: 'bookkeeping.fields.range',
      sortValue: (r) => r.startDate,
      render: (r) => `${r.startDate} – ${r.endDate}`,
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
      key: 'size',
      header: 'bookkeeping.fields.size',
      sortValue: (r) => r.fileBytes ?? 0,
      render: (r) => size(r.fileBytes),
    },
    {
      key: 'created',
      header: 'bookkeeping.fields.requested',
      sortValue: (r) => r.createdAt,
      render: (r) => new Date(r.createdAt).toLocaleString('he-IL'),
    },
    {
      key: 'action',
      header: 'bookkeeping.fields.file',
      render: (r) => {
        if (r.status === 'ready') {
          return (
            <Button onClick={() => void download(r)}>
              <IconDoc /> {t('bookkeeping.download')}
            </Button>
          );
        }
        /* The provider's own words. A bookkeeping export that failed is a thing
           somebody has to act on, and "something went wrong" is not actionable. */
        if (r.status === 'error') return <span className="muted">{r.error ?? '-'}</span>;
        /* An export whose callback has already come and gone is not waiting on
           the provider any more — it is waiting on one more attempt, and the
           person looking at it is the one who can spend it. Before the callback
           lands there is nothing to retry, and `error` is what tells them
           apart: it is only set once an attempt has actually been made. */
        if (r.error) {
          return (
            <Button onClick={() => void retry(r)}>{t('bookkeeping.retry')}</Button>
          );
        }
        return <span className="muted">{t('bookkeeping.preparing')}</span>;
      },
    },
  ];

  return (
    <>
      <FilterBar>
        <Filter label="reports.income.filters.period">
          {(id) => (
            <select id={id} value={preset} onChange={(e) => pick(e.target.value)}>
              {preset === '' && <option value="">{t('reports.income.periods.custom')}</option>}
              {PRESETS.map((p) => (
                <option key={p} value={p}>{t(`reports.income.periods.${p}`)}</option>
              ))}
            </select>
          )}
        </Filter>

        <Filter label="reports.income.filters.from">
          {(id) => (
            <input id={id} type="date" value={range.from} onChange={(e) => edit({ from: e.target.value })} />
          )}
        </Filter>

        <Filter label="reports.income.filters.to">
          {(id) => (
            <input id={id} type="date" value={range.to} onChange={(e) => edit({ to: e.target.value })} />
          )}
        </Filter>
      </FilterBar>

      <fieldset className="bk-include">
        <legend>{t('bookkeeping.include')}</legend>
        {INCLUDES.map((k) => (
          <label key={k}>
            <input
              type="checkbox"
              checked={include[k]}
              onChange={(e) => setInclude((prev) => ({ ...prev, [k]: e.target.checked }))}
            />
            {t(`bookkeeping.includes.${k}`)}
          </label>
        ))}
      </fieldset>

      <p className="muted">{t('bookkeeping.explainer')}</p>

      <Button variant="primary" disabled={!valid} onClick={() => void order()}>
        <IconDoc /> {t('bookkeeping.order')}
      </Button>

      <Table
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        emptyKey="bookkeeping.none"
      />
    </>
  );
}
