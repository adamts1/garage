import { linesSummary, money } from '@garage/shared';
import type { SupplierExpense } from '@garage/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { ClearFilters, Filter, FilterBar } from '../../components/FilterBar';
import { KpiCard, KpiRow } from '../../components/KpiCard';
import { PageHeader } from '../../components/PageHeader';
import { Pill } from '../../components/Pill';
import { PagedTable, RowMenu, type Column } from '../../components/Table';
import { IconBox, IconCard } from '../../icons';
import ExpenseDrawer from './ExpenseDrawer';
import styles from './ExpensesPage.module.css';
import { printExpense } from './printExpense';
import { NO_FILTERS, today, useExpenses, type ExpenseStatusFilter } from './useExpenses';

const fmt = (iso: string) => new Date(iso).toLocaleDateString('he-IL');

export default function ExpensesPage() {
  const { t } = useTranslation();
  const ex = useExpenses();
  const { suppliers, totals, filters, setFilters } = ex;

  const [adding, setAdding] = useState(false);
  /* Kept between drawers: entering a stack of one day's invoices is the normal
     way this screen is used. */
  const [lastDate, setLastDate] = useState(today);

  const columns: Column<SupplierExpense>[] = [
    {
      key: 'date',
      header: 'expenses.fields.date',
      width: 110,
      sortValue: (e) => e.date,
      render: (e) => fmt(e.date),
    },
    {
      key: 'supplier',
      header: 'expenses.fields.supplier',
      sortValue: (e) => e.supplierName ?? '',
      render: (e) => <strong>{e.supplierName ?? '-'}</strong>,
    },
    {
      key: 'description',
      header: 'expenses.fields.description',
      /* The typed description, else the items — an expense entered as lines
         often has no description of its own. */
      render: (e) => <span className={styles.desc}>{e.description || linesSummary(e.lines) || '-'}</span>,
    },
    {
      key: 'reference',
      header: 'expenses.drawer.reference',
      cellClassName: styles.muted,
      render: (e) => e.reference || '-',
    },
    {
      key: 'total',
      header: 'expenses.fields.total',
      sortValue: (e) => e.total,
      /* VAT inside, said in the tooltip — the column a bill is checked by is
         the one on the bottom of the supplier's paper. */
      render: (e) => (
        <strong title={`${t('expenses.fields.subtotal')} ${money(e.subtotal)} · ${t('expenses.fields.vat')} ${money(e.vat)}`}>
          {money(e.total)}
        </strong>
      ),
    },
    {
      key: 'status',
      header: 'expenses.fields.status',
      sortValue: (e) => (e.paid ? 1 : 0),
      render: (e) => (
        <div className={styles.pills}>
          <Pill
            tone={e.paid ? 'ok' : 'warn'}
            title={t('expenses.togglePaid')}
            onClick={() => void ex.togglePaid(e)}
          >
            {t(e.paid ? 'expenses.paid' : 'expenses.awaitingPayment')}
          </Pill>
        </div>
      ),
    },
    {
      key: 'actions',
      header: 'common.actions',
      width: 90,
      render: (e) => (
        <RowMenu items={[
          { label: 'expenses.print', onSelect: () => printExpense(e) },
          { label: e.paid ? 'expenses.markUnpaid' : 'expenses.markPaid', onSelect: () => void ex.togglePaid(e) },
          { label: 'common.delete', onSelect: () => void ex.remove(e), danger: true },
        ]} />
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="expenses.title"
        subtitle="expenses.subtitle"
        actions={
          <Button variant="primary" onClick={() => setAdding(true)} disabled={suppliers.length === 0}>
            ＋ {t('expenses.drawer.title')}
          </Button>
        }
      />

      {/* An expense belongs to a supplier, so with none on file there is
          nothing to record against — say that rather than disabling a button
          with no explanation. */}
      {suppliers.length === 0 && (
        <EmptyState title="expenses.noSuppliersTitle" body="expenses.noSuppliersBody" icon={<IconBox />} />
      )}

      <KpiRow>
        <KpiCard label="expenses.kpi.total" value={money(totals.total)} tone="navy" icon={<IconCard />} />
        <KpiCard label="expenses.kpi.unpaid" value={money(totals.unpaid)} tone="warn" icon={<IconCard />} />
      </KpiRow>

      <FilterBar>
        <Filter label="expenses.fields.supplier">
          {(id) => (
            <select id={id} value={filters.supplierId}
              onChange={(e) => setFilters((f) => ({ ...f, supplierId: e.target.value }))}>
              <option value="">{t('expenses.filters.all')}</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
        </Filter>
        <Filter label="expenses.filters.month">
          {(id) => (
            <input id={id} type="month" value={filters.month}
              onChange={(e) => setFilters((f) => ({ ...f, month: e.target.value }))} />
          )}
        </Filter>
        <Filter label="expenses.filters.status">
          {(id) => (
            <select id={id} value={filters.status}
              onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value as ExpenseStatusFilter }))}>
              <option value="all">{t('expenses.filters.all')}</option>
              <option value="unpaid">{t('expenses.awaitingPayment')}</option>
              <option value="paid">{t('expenses.paid')}</option>
            </select>
          )}
        </Filter>
        <Filter label="common.search">
          {(id) => (
            <input id={id} type="search" value={filters.query}
              placeholder={t('expenses.filters.searchPlaceholder')}
              onChange={(e) => setFilters((f) => ({ ...f, query: e.target.value }))} />
          )}
        </Filter>
        <ClearFilters show={ex.filtered} onClick={() => setFilters(NO_FILTERS)} />
      </FilterBar>

      <PagedTable
        columns={columns}
        rows={ex.shown}
        rowKey={(e) => e.id}
        emptyKey={ex.filtered ? 'expenses.noMatch' : 'expenses.empty'}
      />

      {adding && (
        <ExpenseDrawer
          suppliers={suppliers}
          usedCategories={ex.usedCategories}
          busy={ex.busy}
          initialDate={lastDate}
          onSave={async (draft) => {
            const ok = await ex.create(draft);
            if (ok) setLastDate(draft.date);
            return ok;
          }}
          onClose={() => setAdding(false)}
        />
      )}
    </>
  );
}
