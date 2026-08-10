import { listExpenses, money, subscribeToExpenses, type SupplierExpense, type Ticket } from '@garage/shared';
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
import { BUCKETS, agingTotals, customerAging, supplierAging, type AgingRow } from './agingRollUp';

type Side = 'customers' | 'suppliers';

/**
 * How old the debts are — both directions.
 *
 * The total is not the point. A garage knows roughly what it is owed; what it
 * does not know is which part of that has been sitting there since March. So
 * every row is broken into four ages, and the table sorts by the oldest debt in
 * the row rather than by its size — ₪800 nobody has paid in four months is a
 * bigger problem than ₪8,000 invoiced last week.
 */
export default function AgingReport({ tickets }: { tickets: Ticket[] }) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const [expenses, setExpenses] = useState<SupplierExpense[]>([]);
  const [side, setSide] = useState<Side>('customers');
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

  const rows = useMemo(
    () => (side === 'customers' ? customerAging(tickets, now) : supplierAging(expenses, now)),
    [side, tickets, expenses, now],
  );
  const totals = useMemo(() => agingTotals(rows), [rows]);

  const columns: Column<AgingRow>[] = [
    {
      key: 'name',
      header: side === 'customers' ? 'reports.aging.fields.customer' : 'reports.aging.fields.supplier',
      sortValue: (r) => r.name,
      render: (r) => (
        <>
          <div className={styles.name}>{r.name}</div>
          {r.sub && <div className={styles.sub}>{r.sub}</div>}
        </>
      ),
    },
    ...BUCKETS.map((b): Column<AgingRow> => ({
      key: b.id,
      header: `reports.aging.buckets.${b.id}`,
      sortValue: (r) => r.buckets[b.id],
      /* The oldest column is the one the report exists for, so it is the one
         that is coloured. Colouring all four would colour nothing. */
      render: (r) => (
        r.buckets[b.id] === 0 ? '-'
        : b.id === 'ninety' ? <span className={styles.open}>{money(r.buckets[b.id])}</span>
        : money(r.buckets[b.id])
      ),
    })),
    {
      key: 'total',
      header: 'reports.aging.fields.total',
      sortValue: (r) => r.total,
      cellClassName: styles.amount,
      render: (r) => money(r.total),
    },
    {
      key: 'oldest',
      header: 'reports.aging.fields.oldest',
      sortValue: (r) => r.oldest,
      render: (r) => t('reports.aging.days', { count: Math.max(0, r.oldest) }),
    },
  ];

  const table = useTable({ rows, columns, defaultSort: { key: 'oldest', dir: -1 } });

  const exportCsv = () => {
    const head = [
      t(side === 'customers' ? 'reports.aging.fields.customer' : 'reports.aging.fields.supplier'),
      ...BUCKETS.map((b) => t(`reports.aging.buckets.${b.id}`)),
      t('reports.aging.fields.total'), t('reports.aging.fields.oldest'),
    ];
    const body = table.sorted.map((r) => [
      r.name, ...BUCKETS.map((b) => r.buckets[b.id].toFixed(2)), r.total.toFixed(2), r.oldest,
    ]);
    const csv = [head, ...body].map((line) => line.join(',')).join('\n');
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `aging-${side}-${now}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <FilterBar>
        <Filter label="reports.aging.filters.side">
          {(id) => (
            <select id={id} value={side} onChange={(e) => setSide(e.target.value as Side)}>
              <option value="customers">{t('reports.aging.sides.customers')}</option>
              <option value="suppliers">{t('reports.aging.sides.suppliers')}</option>
            </select>
          )}
        </Filter>
      </FilterBar>

      <KpiRow>
        <KpiCard
          label={side === 'customers' ? 'reports.aging.kpi.owedToUs' : 'reports.aging.kpi.owedByUs'}
          sub="reports.aging.kpi.totalSub"
          value={money(totals.total)}
          tone={side === 'customers' ? 'ok' : 'warn'}
          icon={<IconReports />}
        />
        <KpiCard
          label="reports.aging.kpi.overNinety"
          sub="reports.aging.kpi.overNinetySub"
          value={money(totals.buckets.ninety)}
          tone="danger"
          icon={<IconCard />}
        />
        <KpiCard
          label="reports.aging.kpi.current"
          sub="reports.aging.kpi.currentSub"
          value={money(totals.buckets.current)}
          icon={<IconCard />}
        />
        <KpiCard
          label={side === 'customers' ? 'reports.aging.kpi.customers' : 'reports.aging.kpi.suppliers'}
          sub="reports.aging.kpi.countSub"
          value={String(totals.count)}
          icon={<IconCustomers />}
        />
      </KpiRow>

      <section className={styles.tableCard}>
        <h3 className={styles.tableTitle}>
          {t(`reports.aging.breakdown.${side}`, { count: rows.length })}
          <Button onClick={exportCsv}>⭳ {t('reports.export')}</Button>
        </h3>

        <Table
          columns={columns}
          rows={table.sorted}
          rowKey={(r) => r.id}
          emptyKey={side === 'customers' ? 'reports.aging.emptyCustomers' : 'reports.aging.emptySuppliers'}
          sort={table.sort}
          onToggleSort={table.toggleSort}
        />
      </section>
    </>
  );
}
