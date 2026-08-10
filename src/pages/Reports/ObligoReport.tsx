import { listExpenses, money, subscribeToExpenses, type SupplierExpense } from '@garage/shared';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/Button';
import { Filter, FilterBar } from '../../components/FilterBar';
import { KpiCard, KpiRow } from '../../components/KpiCard';
import { Table, useTable, type Column } from '../../components/Table';
import { IconCard, IconCustomers, IconReports } from '../../icons';
import { showError, useAppDispatch } from '../../store';
import { today } from './localDay';
import styles from './ReportsPage.module.css';
import { bySupplier, byMonth, obligoTotals, type MonthObligo, type SupplierObligo } from './obligoRollUp';

type Grouping = 'supplier' | 'month';

/**
 * What the garage owes.
 *
 * Two groupings of the same bills, because they answer different questions: by
 * supplier is "who am I into", by month is "what leaves the account, and when".
 * The second is why cheque dates exist — a bill's due date is when the supplier
 * is owed, and a post-dated cheque decides when the money actually goes.
 */
export default function ObligoReport() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const [expenses, setExpenses] = useState<SupplierExpense[]>([]);
  const [grouping, setGrouping] = useState<Grouping>('supplier');
  const [now] = useState(today);

  useEffect(() => {
    let alive = true;
    const load = () => listExpenses()
      .then((rows) => { if (alive) setExpenses(rows); })
      .catch((e) => dispatch(showError(e)));
    load();
    const off = subscribeToExpenses(load);
    return () => { alive = false; off(); };
  }, [dispatch]);

  const totals = useMemo(() => obligoTotals(expenses, now), [expenses, now]);
  const supplierRows = useMemo(() => bySupplier(expenses, now), [expenses, now]);
  const monthRows = useMemo(() => byMonth(expenses), [expenses]);

  const supplierColumns: Column<SupplierObligo>[] = [
    { key: 'supplier', header: 'reports.obligo.fields.supplier', sortValue: (r) => r.supplier, render: (r) => r.supplier },
    { key: 'count', header: 'reports.obligo.fields.bills', sortValue: (r) => r.count, render: (r) => r.count },
    {
      key: 'oldestDue',
      header: 'reports.obligo.fields.oldestDue',
      sortValue: (r) => r.oldestDue,
      render: (r) => r.oldestDue || '-',
    },
    {
      key: 'overdue',
      header: 'reports.obligo.fields.overdue',
      sortValue: (r) => r.overdue,
      // Zero is the answer a garage wants here, so it is not dressed up in red.
      render: (r) => (r.overdue > 0 ? <span className={styles.open}>{money(r.overdue)}</span> : '-'),
    },
    {
      key: 'total',
      header: 'reports.obligo.fields.total',
      sortValue: (r) => r.total,
      cellClassName: styles.amount,
      render: (r) => money(r.total),
    },
  ];

  const monthColumns: Column<MonthObligo>[] = [
    { key: 'month', header: 'reports.obligo.fields.month', sortValue: (r) => r.month, render: (r) => r.month },
    { key: 'count', header: 'reports.obligo.fields.bills', sortValue: (r) => r.count, render: (r) => r.count },
    {
      key: 'onCheques',
      header: 'reports.obligo.fields.onCheques',
      sortValue: (r) => r.onCheques,
      render: (r) => (r.onCheques > 0 ? money(r.onCheques) : '-'),
    },
    {
      key: 'total',
      header: 'reports.obligo.fields.total',
      sortValue: (r) => r.total,
      cellClassName: styles.amount,
      render: (r) => money(r.total),
    },
  ];

  const supplierTable = useTable({
    rows: supplierRows, columns: supplierColumns, defaultSort: { key: 'total', dir: -1 },
  });
  const monthTable = useTable({
    rows: monthRows, columns: monthColumns, defaultSort: { key: 'month', dir: 1 },
  });

  const exportCsv = () => {
    const head = grouping === 'supplier'
      ? [t('reports.obligo.fields.supplier'), t('reports.obligo.fields.bills'), t('reports.obligo.fields.oldestDue'), t('reports.obligo.fields.overdue'), t('reports.obligo.fields.total')]
      : [t('reports.obligo.fields.month'), t('reports.obligo.fields.bills'), t('reports.obligo.fields.onCheques'), t('reports.obligo.fields.total')];
    const body = grouping === 'supplier'
      ? supplierTable.sorted.map((r) => [r.supplier, r.count, r.oldestDue, r.overdue.toFixed(2), r.total.toFixed(2)])
      : monthTable.sorted.map((r) => [r.month, r.count, r.onCheques.toFixed(2), r.total.toFixed(2)]);
    const csv = [head, ...body].map((line) => line.join(',')).join('\n');
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `obligo-${grouping}-${now}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <FilterBar>
        <Filter label="reports.obligo.filters.grouping">
          {(id) => (
            <select id={id} value={grouping} onChange={(e) => setGrouping(e.target.value as Grouping)}>
              <option value="supplier">{t('reports.obligo.groupings.supplier')}</option>
              <option value="month">{t('reports.obligo.groupings.month')}</option>
            </select>
          )}
        </Filter>
      </FilterBar>

      <KpiRow>
        <KpiCard
          label="reports.obligo.kpi.outstanding"
          sub="reports.obligo.kpi.outstandingSub"
          value={money(totals.outstanding)}
          tone="warn"
          icon={<IconReports />}
        />
        <KpiCard
          label="reports.obligo.kpi.overdue"
          sub="reports.obligo.kpi.overdueSub"
          value={money(totals.overdue)}
          tone="danger"
          icon={<IconCard />}
        />
        <KpiCard
          label="reports.obligo.kpi.cheques"
          sub="reports.obligo.kpi.chequesSub"
          value={money(totals.onFutureCheques)}
          icon={<IconCard />}
        />
        <KpiCard
          label="reports.obligo.kpi.suppliers"
          sub="reports.obligo.kpi.suppliersSub"
          value={String(totals.suppliers)}
          icon={<IconCustomers />}
        />
      </KpiRow>

      <section className={styles.tableCard}>
        <h3 className={styles.tableTitle}>
          {t(`reports.obligo.breakdown.${grouping}`)}
          <Button onClick={exportCsv}>⭳ {t('reports.export')}</Button>
        </h3>

        {grouping === 'supplier' ? (
          <Table
            columns={supplierColumns}
            rows={supplierTable.sorted}
            rowKey={(r) => r.supplierId}
            emptyKey="reports.obligo.emptySupplier"
            sort={supplierTable.sort}
            onToggleSort={supplierTable.toggleSort}
          />
        ) : (
          <Table
            columns={monthColumns}
            rows={monthTable.sorted}
            rowKey={(r) => r.month}
            emptyKey="reports.obligo.emptyMonth"
            sort={monthTable.sort}
            onToggleSort={monthTable.toggleSort}
          />
        )}
      </section>
    </>
  );
}
