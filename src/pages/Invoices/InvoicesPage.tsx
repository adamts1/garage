import type { Invoice } from '@garage/shared';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '../../components/EmptyState';
import { ClearFilters, Filter, FilterBar } from '../../components/FilterBar';
import { KpiCard, KpiRow } from '../../components/KpiCard';
import { PageHeader } from '../../components/PageHeader';
import { Pill } from '../../components/Pill';
import { Table, type Column } from '../../components/Table';
import { IconCard, IconCheck, IconDoc } from '../../icons';
import InvoiceDetail from './InvoiceDetail';
import styles from './InvoicesPage.module.css';
import { useInvoices, type DocTypeFilter, type StatusFilter } from './useInvoices';

const shekel = (n: number) =>
  '₪' + n.toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const shekelRound = (n: number) => '₪' + Math.round(n).toLocaleString('he-IL');
const fmt = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString('he-IL') : '-');

export interface InvoicesPageProps {
  onOpenTicket: (key: string) => void;
}

/* Invoices are READ from the stored, immutable invoices table — one row per
   real document iCount issued. Nothing here recomputes anything from live
   tickets (the §3.1 bug): number, VAT and totals are whatever was frozen at
   issue. See docs/PRODUCTION.md §4a. */
export default function InvoicesPage({ onOpenTicket }: InvoicesPageProps) {
  const { t } = useTranslation();
  const inv = useInvoices();

  const docLabel = (d: Invoice['docType']) => t(`invoices.docType.${d}`);
  const statusLabel = (s: Invoice['status']) => t(`invoices.status.${s}`);
  const statusTone = (s: Invoice['status']) => (s === 'issued' ? 'ok' as const : 'danger' as const);

  const columns: Column<Invoice>[] = [
    {
      key: 'docnum',
      header: 'invoices.fields.docnum',
      width: 96,
      sortValue: (i) => i.docnum,
      render: (i) => <b className={styles.docnum}>{i.docnum}</b>,
    },
    {
      key: 'customer',
      header: 'invoices.fields.customer',
      sortValue: (i) => i.customerName ?? '',
      render: (i) => i.customerName ?? '-',
    },
    {
      key: 'issuedAt',
      header: 'invoices.fields.issuedAt',
      width: 110,
      /* Sorts on the ISO timestamp while the cell shows a Hebrew short date,
         which as text would order by day-of-month. */
      sortValue: (i) => i.issuedAt ?? '',
      cellClassName: styles.muted,
      render: (i) => fmt(i.issuedAt),
    },
    {
      key: 'docType',
      header: 'invoices.fields.docType',
      width: 170,
      sortValue: (i) => i.docType,
      cellClassName: styles.muted,
      render: (i) => docLabel(i.docType),
    },
    {
      key: 'total',
      header: 'invoices.fields.total',
      width: 120,
      sortValue: (i) => i.total,
      render: (i) => <strong>{shekel(i.total)}</strong>,
    },
    {
      key: 'status',
      header: 'invoices.fields.status',
      width: 120,
      sortValue: (i) => i.status,
      render: (i) => <Pill tone={statusTone(i.status)}>{statusLabel(i.status)}</Pill>,
    },
    {
      key: 'allocation',
      header: 'invoices.fields.allocation',
      width: 130,
      cellClassName: styles.muted,
      render: (i) => i.allocationNumber ?? '-',
    },
  ];

  const body = () => {
    if (inv.loading) {
      return <EmptyState title="invoices.loading" icon={<IconDoc />} />;
    }
    if (inv.invoices.length === 0) {
      return (
        <EmptyState
          title="invoices.emptyTitle"
          body="invoices.emptyBody"
          icon={<IconDoc />}
          large
        />
      );
    }
    if (inv.shown.length === 0) {
      return (
        <EmptyState title="invoices.noMatchTitle" body="invoices.noMatchBody" icon={<IconDoc />} />
      );
    }

    return (
      <>
        <Table
          columns={columns}
          rows={inv.shown}
          rowKey={(i) => i.id}
          onRowClick={(i) => inv.setSelectedId(i.id === inv.selectedId ? null : i.id)}
          isRowSelected={(i) => i.id === inv.selectedId}
          footer={
            <span className={styles.footRow}>
              <span>{t(inv.filtered ? 'invoices.netFiltered' : 'invoices.net')}</span>
              <strong>{shekel(inv.shownNet)}</strong>
              <span className={styles.muted}>
                {t('invoices.showing', { shown: inv.shown.length, total: inv.invoices.length })}
              </span>
            </span>
          }
        />
        <p className={styles.hint}>{t('invoices.rowHint')}</p>
      </>
    );
  };

  return (
    <>
      <PageHeader title="invoices.title" subtitle="invoices.subtitle" />

      <KpiRow>
        <KpiCard
          label="invoices.kpi.issued"
          value={shekelRound(inv.totals.issued)}
          sub="invoices.kpi.issuedSub"
          subValues={{ count: inv.totals.issuedCount }}
          tone="navy"
          icon={<IconDoc />}
        />
        <KpiCard
          label="invoices.kpi.receipts"
          value={String(inv.totals.receiptCount)}
          sub="invoices.kpi.receiptsSub"
          tone="ok"
          icon={<IconCheck />}
        />
        <KpiCard
          label="invoices.kpi.cancelled"
          value={String(inv.totals.cancelledCount)}
          sub="invoices.kpi.cancelledSub"
          tone="danger"
          icon={<IconCard />}
        />
      </KpiRow>

      <FilterBar>
        <Filter label="invoices.filters.search">
          {(id) => (
            <input
              id={id}
              value={inv.query}
              onChange={(e) => inv.setQuery(e.target.value)}
              placeholder={t('invoices.filters.searchPlaceholder')}
            />
          )}
        </Filter>

        <Filter label="invoices.filters.docType">
          {(id) => (
            <select
              id={id}
              value={inv.docType}
              onChange={(e) => inv.setDocType(e.target.value as DocTypeFilter)}
            >
              <option value="all">{t('invoices.filters.allDocTypes')}</option>
              <option value="invoice_receipt">{t('invoices.docType.invoice_receipt')}</option>
              <option value="credit_note">{t('invoices.docType.credit_note')}</option>
            </select>
          )}
        </Filter>

        <Filter label="invoices.filters.status">
          {(id) => (
            <select
              id={id}
              value={inv.status}
              onChange={(e) => inv.setStatus(e.target.value as StatusFilter)}
            >
              <option value="all">{t('invoices.filters.allStatuses')}</option>
              <option value="issued">{t('invoices.status.issued')}</option>
              <option value="cancelled">{t('invoices.status.cancelled')}</option>
            </select>
          )}
        </Filter>

        <ClearFilters show={inv.filtered} onClick={inv.clear} />
      </FilterBar>

      <section className={styles.card}>{body()}</section>

      {inv.selected && (
        <InvoiceDetail
          invoice={inv.selected}
          docLabel={docLabel}
          statusLabel={statusLabel}
          statusTone={statusTone}
          onOpenTicket={onOpenTicket}
        />
      )}
    </>
  );
}
