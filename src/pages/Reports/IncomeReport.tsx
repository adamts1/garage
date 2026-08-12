import { listInvoices, money, subscribeToInvoices, type Invoice } from '@garage/shared';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/Button';
import { Filter, FilterBar } from '../../components/FilterBar';
import { KpiCard, KpiRow } from '../../components/KpiCard';
import { Table, type Column } from '../../components/Table';
import { IconCard, IconDoc, IconReports } from '../../icons';
import { downloadXlsx } from '../../lib/xlsx';
import { showError, useAppDispatch } from '../../store';
import styles from './ReportsPage.module.css';
import { presetRange, summarise, type DateRange, type IncomeLine } from './incomeRollUp';

/* The periods a garage asks for by name. "Custom" is not in the list — typing a
   date into either box is what makes it custom, and a preset that has to be
   selected before the boxes work is a step for nothing. */
const PRESETS = ['thisMonth', 'lastMonth', 'thisVatPeriod', 'thisYear', 'all'] as const;

/**
 * What was billed, over a period the garage picks.
 *
 * One line per kind of document, because that is how the question is actually
 * asked — "how much did we invoice, how much is still owed, how much came in,
 * how much did we give back" is four numbers, not one.
 */
export default function IncomeReport() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [preset, setPreset] = useState<string>('thisMonth');
  const [range, setRange] = useState<DateRange>(() => presetRange('thisMonth', new Date()));

  useEffect(() => {
    let alive = true;
    const load = () => listInvoices()
      .then((rows) => { if (alive) setInvoices(rows); })
      .catch((e) => dispatch(showError(e)));
    load();
    const off = subscribeToInvoices(load);
    return () => { alive = false; off(); };
  }, [dispatch]);

  const summary = useMemo(() => summarise(invoices, range), [invoices, range]);

  /* Picking a preset fills the boxes; editing a box leaves the preset behind,
     because the dates on screen are the truth and a label saying "this month"
     over a range that is not this month would be a lie. */
  const pick = (id: string) => {
    setPreset(id);
    setRange(presetRange(id, new Date()));
  };
  const edit = (patch: Partial<DateRange>) => {
    setPreset('');
    setRange((prev) => ({ ...prev, ...patch }));
  };

  const columns: Column<IncomeLine>[] = [
    {
      key: 'docType',
      header: 'reports.income.fields.docType',
      sortValue: (l) => l.docType,
      render: (l) => t(`invoices.docType.${l.docType}`),
    },
    { key: 'count', header: 'reports.income.fields.count', sortValue: (l) => l.count, render: (l) => l.count },
    { key: 'net', header: 'reports.income.fields.net', sortValue: (l) => l.net, render: (l) => money(l.net) },
    { key: 'vat', header: 'reports.income.fields.vat', sortValue: (l) => l.vat, render: (l) => money(l.vat) },
    {
      key: 'gross',
      header: 'reports.income.fields.gross',
      sortValue: (l) => l.gross,
      cellClassName: styles.amount,
      render: (l) => money(l.gross),
    },
  ];

  /* Numbers go out as numbers, not as `toFixed(2)` strings: the sheet decides
     how they are shown, and a bookkeeper who selects the column gets a sum. */
  const exportSheet = () => {
    downloadXlsx(`income-${range.from || 'start'}-${range.to || 'today'}`, {
      name: t('reports.tabs.income'),
      columns: [
        { header: t('reports.income.fields.docType'), width: 24 },
        { header: t('reports.income.fields.count'), width: 10, format: 'int' },
        { header: t('reports.income.fields.net'), width: 14, format: 'money' },
        { header: t('reports.income.fields.vat'), width: 14, format: 'money' },
        { header: t('reports.income.fields.gross'), width: 14, format: 'money' },
      ],
      rows: summary.lines.map((l) => [
        t(`invoices.docType.${l.docType}`), l.count, l.net, l.vat, l.gross,
      ]),
    });
  };

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

      <KpiRow>
        <KpiCard
          label="reports.income.kpi.billed"
          sub="reports.income.kpi.billedSub"
          value={money(summary.billed)}
          tone="ok"
          icon={<IconReports />}
        />
        <KpiCard
          label="reports.income.kpi.net"
          sub="reports.income.kpi.netSub"
          value={money(summary.billedNet)}
          icon={<IconDoc />}
        />
        <KpiCard
          label="reports.income.kpi.vat"
          sub="reports.income.kpi.vatSub"
          value={money(summary.billedVat)}
          tone="warn"
          icon={<IconDoc />}
        />
        {/* Beside what was billed, never inside it: a receipt is income already
            counted, arriving. Adding the two counts the same work twice. */}
        <KpiCard
          label="reports.income.kpi.collected"
          sub="reports.income.kpi.collectedSub"
          value={money(summary.collected)}
          icon={<IconCard />}
        />
        <KpiCard
          label="reports.income.kpi.credited"
          sub="reports.income.kpi.creditedSub"
          value={money(summary.credited)}
          tone="danger"
          icon={<IconCard />}
        />
      </KpiRow>

      <section className={styles.tableCard}>
        <h3 className={styles.tableTitle}>
          {t('reports.income.breakdown')}
          <Button onClick={exportSheet}>⭳ {t('reports.export')}</Button>
        </h3>

        <Table
          columns={columns}
          rows={summary.lines}
          rowKey={(l) => l.docType}
          emptyKey="reports.income.empty"
        />
      </section>
    </>
  );
}
