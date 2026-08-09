import { COLUMNS, money, VAT, type Status, type Ticket } from '@garage/shared';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/Button';
import { ClearFilters, Filter, FilterBar } from '../../components/FilterBar';
import { KpiCard, KpiRow } from '../../components/KpiCard';
import { Pagination, usePagination } from '../../components/Pagination';
import { Table, useTable, type Column } from '../../components/Table';
import { IconCustomers, IconDoc, IconReports, IconTickets } from '../../icons';
import styles from './ReportsPage.module.css';
import { useCustomerReport, type DocFilter, type ReportRow } from './useCustomerReport';


const vatPercent = Math.round(VAT * 100);

/** What each customer has been worth, rolled up from their tickets. The report
 *  this page started as, now one tab of four — the page header and the print
 *  and export buttons moved up to the shell, which is the only part of it that
 *  is the same for every report. */
export default function CustomerReport({ tickets }: { tickets: Ticket[] }) {
  const { t } = useTranslation();
  const report = useCustomerReport(tickets);

  const columns: Column<ReportRow>[] = [
    {
      key: 'name',
      header: 'reports.fields.customer',
      sortValue: (r) => r.name,
      /* The number under the name, because it is what the row is grouped by —
         it used to be a sequential 1001+i that identified nothing and changed
         whenever a filter did. */
      render: (r) => (
        <>
          <div className={styles.name}>{r.name}</div>
          <div className={styles.sub}>{r.phone}</div>
        </>
      ),
    },
    { key: 'tickets', header: 'reports.fields.tickets', sortValue: (r) => r.tickets, render: (r) => r.tickets },
    { key: 'net', header: 'reports.fields.net', sortValue: (r) => r.net, render: (r) => money(r.net) },
    {
      key: 'vat',
      /* The rate is part of the heading, so it is interpolated rather than
         baked into the Hebrew string. */
      renderHeader: () => t('reports.fields.vat', { percent: vatPercent }),
      sortValue: (r) => r.vat,
      render: (r) => money(r.vat),
    },
    {
      key: 'gross',
      header: 'reports.fields.gross',
      sortValue: (r) => r.gross,
      cellClassName: styles.amount,
      render: (r) => money(r.gross),
    },
    {
      key: 'balance',
      header: 'reports.fields.balance',
      sortValue: (r) => r.balance,
      render: (r) => (
        <span className={r.balance > 0 ? styles.open : styles.clear}>{money(r.balance)}</span>
      ),
    },
    { key: 'avg', header: 'reports.fields.avg', sortValue: (r) => r.avg, render: (r) => money(r.avg) },
  ];

  /* The table's own sort, lifted out so pagination slices the sorted rows
     rather than sorting a page at a time. */
  const { sorted, sort, toggleSort } = useTable({
    rows: report.rows,
    columns,
    defaultSort: { key: 'gross', dir: -1 },
  });

  const pager = usePagination({ rows: sorted });

  const exportCsv = () => {
    const head = [
      t('reports.fields.customer'), t('reports.fields.phone'), t('reports.fields.tickets'),
      t('reports.fields.net'), t('reports.fields.vat', { percent: vatPercent }),
      t('reports.fields.gross'), t('reports.fields.balance'), t('reports.fields.avg'),
    ];
    // Every row, not the page on screen — a report you exported a tenth of is
    // worse than no export.
    const body = sorted.map((r) => [
      r.name, r.phone, r.tickets,
      r.net.toFixed(2), r.vat.toFixed(2), r.gross.toFixed(2),
      r.balance.toFixed(2), r.avg.toFixed(2),
    ]);
    const csv = [head, ...body].map((line) => line.join(',')).join('\n');
    // The BOM is what makes Excel read this as UTF-8 rather than mojibake.
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'customer-report.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <FilterBar>
        <Filter label="reports.filters.customer">
          {(id) => (
            <input
              id={id}
              value={report.query}
              onChange={(e) => report.setQuery(e.target.value)}
              placeholder={t('reports.filters.customerPlaceholder')}
            />
          )}
        </Filter>

        <Filter label="reports.filters.status">
          {(id) => (
            <select
              id={id}
              value={report.status}
              onChange={(e) => report.setStatus(e.target.value as Status | 'all')}
            >
              <option value="all">{t('reports.filters.allStatuses')}</option>
              {COLUMNS.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
          )}
        </Filter>

        <Filter label="reports.filters.doc">
          {(id) => (
            <select
              id={id}
              value={report.docFilter}
              onChange={(e) => report.setDocFilter(e.target.value as DocFilter)}
            >
              <option value="all">{t('reports.filters.docAll')}</option>
              <option value="paid">{t('reports.filters.docPaid')}</option>
              <option value="open">{t('reports.filters.docOpen')}</option>
              <option value="none">{t('reports.filters.docNone')}</option>
            </select>
          )}
        </Filter>

        <ClearFilters show={report.filtered} onClick={report.clear} />
      </FilterBar>

      <KpiRow>
        <KpiCard label="reports.kpi.gross" sub="reports.kpi.grossSub" value={money(report.totals.gross)} tone="ok" icon={<IconReports />} />
        <KpiCard label="reports.kpi.net" sub="reports.kpi.netSub" value={money(report.totals.net)} icon={<IconDoc />} />
        <KpiCard label="reports.kpi.vat" sub="reports.kpi.vatSub" subValues={{ percent: vatPercent }} value={money(report.totals.vat)} tone="warn" icon={<IconDoc />} />
        <KpiCard label="reports.kpi.tickets" sub="reports.kpi.ticketsSub" value={String(report.totals.count)} icon={<IconTickets />} />
        <KpiCard label="reports.kpi.customers" sub="reports.kpi.customersSub" value={String(report.totals.customers)} icon={<IconCustomers />} />
        <KpiCard label="reports.kpi.avg" sub="reports.kpi.avgSub" value={money(report.totals.avg)} icon={<IconReports />} />
      </KpiRow>

      <section className={styles.tableCard}>
        <h3 className={styles.tableTitle}>
          {t('reports.breakdown', { count: report.rows.length })}
          <Button onClick={exportCsv}>⭳ {t('reports.export')}</Button>
        </h3>

        <Table
          columns={columns}
          rows={pager.slice}
          rowKey={(r) => r.name}
          emptyKey="reports.empty"
          /* Sort state is owned above so it applies across pages; the table is
             told what it is rather than keeping its own. */
          sort={sort}
          onToggleSort={toggleSort}
        />

        <Pagination
          page={pager.page}
          pages={pager.pages}
          perPage={pager.perPage}
          from={pager.from}
          to={pager.to}
          total={pager.total}
          onPage={pager.setPage}
          onPerPage={pager.setPerPage}
        />
      </section>
    </>
  );
}
