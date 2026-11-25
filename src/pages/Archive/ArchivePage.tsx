import { COLUMNS, isArchived, isCancelled, searchLegacyTickets, shekel, workerChip, type Ticket, type WorkerMap } from '@garage/shared';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/Button';
import { Filter, FilterBar } from '../../components/FilterBar';
import { Pill } from '../../components/Pill';
import { PageHeader } from '../../components/PageHeader';
import { Pagination } from '../../components/Pagination';
import { SearchBar } from '../../components/SearchBar';
import { PagedTable, Table, type Column } from '../../components/Table';
import { TabPanel, Tabs, type TabDef } from '../../components/Tabs';
import { IconClock } from '../../icons';
import { epicChip } from '../../lib/epic';
import { downloadXlsx } from '../../lib/xlsx';
import { PER_PAGE_OPTIONS, useServerPage } from '../../lib/useServerPage';
import styles from './ArchivePage.module.css';

type TabId = 'own' | 'legacy';
const TABS: readonly TabDef<TabId>[] = [
  { id: 'own', label: 'archive.tabAll' },
  { id: 'legacy', label: 'archive.tabLegacy' },
];

/* Active is what is still on the board (board_hidden included — hiding is a
   view choice, not a status); archived is paid and aged past the cutoff;
   cancelled is its own bucket, so "archive" here means work that was done. */
type StatusFilter = 'all' | 'active' | 'archived' | 'cancelled';
const matchesStatus = (ticket: Ticket, status: StatusFilter): boolean => {
  if (status === 'all') return true;
  if (status === 'cancelled') return isCancelled(ticket);
  if (status === 'archived') return isArchived(ticket) && !isCancelled(ticket);
  return !isArchived(ticket);
};

/** Work cards imported from the previous system (RB-…): searched and paged by
 *  the database, since they are not in the board's list — a garage moving
 *  over can bring tens of thousands. Each opens read-only. */
function LegacyArchive({ onOpenTicket }: { onOpenTicket: (k: string) => void }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const { rows, total, pager, loaded, searching } = useServerPage(searchLegacyTickets, query);
  const columns: Column<Ticket>[] = [
    { key: 'k', header: 'archive.fields.key', width: 96, cellClassName: styles.key, render: (x) => x.k },
    { key: 'date', header: 'customer.fields.created', width: 110, render: (x) => x.createdAt ?? '—' },
    { key: 'title', header: 'archive.fields.title', render: (x) => x.title || t('common.untitled') },
    { key: 'customer', header: 'archive.fields.customer', render: (x) => x.customer || '—' },
    { key: 'plate', header: 'archive.fields.plate', render: (x) => <span className={styles.plate}>{x.plate}</span> },
    { key: 'car', header: 'archive.fields.car', render: (x) => x.car },
    { key: 'amount', header: 'archive.fields.amount', width: 120, cellClassName: styles.amount, render: (x) => (x.amount ? shekel(x.amount) : '-') },
  ];
  return (
    <>
      <p className={styles.hint}>{t('car.legacy.archiveHint')} · {total}</p>
      <SearchBar value={query} onChange={setQuery} placeholder="car.legacy.searchPlaceholder" />
      <Table
        columns={columns}
        rows={rows}
        rowKey={(x) => x.k}
        onRowClick={(x) => onOpenTicket(x.k)}
        empty={!loaded || searching ? t('app.loading') : t('archive.noMatch')}
        className={styles.table}
      />
      <Pagination {...pager} perPageOptions={PER_PAGE_OPTIONS} />
    </>
  );
}

export interface ArchivePageProps {
  /** Every ticket of the garage — active, archived and cancelled. */
  tickets: Ticket[];
  /** Code → chip. Retired workers included: most of what is listed here is
   *  history, so it is the view that most needs them to keep resolving. */
  workerChips: WorkerMap;
  onOpenTicket: (k: string) => void;
}



export default function ArchivePage({ tickets, workerChips, onOpenTicket }: ArchivePageProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<TabId>('own');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const kept = tickets.filter((ticket) =>
      matchesStatus(ticket, status)
      && (!q || (ticket.k + ticket.title + ticket.plate + ticket.car + ticket.customer)
        .toLowerCase()
        .includes(q)),
    );

    /* Newest settled first, done here rather than through the table's own sort:
       the ordering is on createdAtISO, which no column renders, and a
       `defaultSort` naming a key with no column silently does nothing. Clicking
       a header still re-sorts from here. */
    return [...kept].sort((a, b) => (b.createdAtISO ?? '').localeCompare(a.createdAtISO ?? ''));
  }, [tickets, query, status]);

  const statusLabel = (ticket: Ticket): string =>
    isCancelled(ticket)
      ? t('archive.cancelled')
      : COLUMNS.find((c) => c.id === ticket.st)?.title ?? ticket.st;

  const columns: Column<Ticket>[] = [
    {
      key: 'k',
      header: 'archive.fields.key',
      width: 96,
      sortValue: (ticket) => ticket.k,
      cellClassName: styles.key,
      render: (ticket) => ticket.k,
    },
    {
      key: 'title',
      header: 'archive.fields.title',
      sortValue: (ticket) => ticket.title,
      render: (ticket) => {
        const epic = epicChip(ticket.epic);
        return (
          <>
            <div className={styles.title}>{ticket.title || t('common.untitled')}</div>
            <span className={styles.epic} style={{ background: epic.bg, color: epic.c }}>
              {epic.t}
            </span>
          </>
        );
      },
    },
    {
      key: 'status',
      header: 'archive.fields.status',
      width: 120,
      sortValue: (ticket) => statusLabel(ticket),
      render: (ticket) =>
        isCancelled(ticket) ? (
          <Pill tone="danger" title={ticket.cancelReason ?? undefined}>{t('archive.cancelled')}</Pill>
        ) : (
          statusLabel(ticket)
        ),
    },
    {
      key: 'customer',
      header: 'archive.fields.customer',
      sortValue: (ticket) => ticket.customer,
      render: (ticket) => ticket.customer,
    },
    {
      key: 'plate',
      header: 'archive.fields.plate',
      render: (ticket) => <span className={styles.plate}>{ticket.plate}</span>,
    },
    {
      key: 'car',
      header: 'archive.fields.car',
      render: (ticket) => ticket.car,
    },
    {
      key: 'due',
      header: 'archive.fields.due',
      width: 120,
      render: (ticket) => (ticket.due && ticket.due !== '-' ? ticket.due : '—'),
    },
    {
      key: 'who',
      header: 'archive.fields.worker',
      width: 90,
      render: (ticket) => {
        const chip = workerChip(workerChips, ticket.who);
        return (
          <span className={styles.avatar} style={{ background: chip.bg }}>
            {chip.ini}
          </span>
        );
      },
    },
    {
      key: 'amount',
      header: 'archive.fields.amount',
      width: 120,
      /* Sorts on the number while the cell shows ₪1,200 — the reason a column
         carries its sort value separately from what it renders. */
      sortValue: (ticket) => ticket.amount,
      cellClassName: styles.amount,
      render: (ticket) => (ticket.amount ? shekel(ticket.amount) : '-'),
    },
  ];

  /* Every filtered row, not the page on screen, with the table's columns in
     the table's order. The worker goes out as a name: initials on a coloured
     dot mean nothing in a spreadsheet. */
  const exportSheet = () => {
    downloadXlsx('work-cards', {
      name: t('archive.title'),
      columns: [
        { header: t('archive.fields.key'), width: 12 },
        { header: t('archive.fields.title'), width: 32 },
        { header: t('archive.fields.status'), width: 14 },
        { header: t('archive.fields.customer'), width: 24 },
        { header: t('archive.fields.plate'), width: 14 },
        { header: t('archive.fields.car'), width: 20 },
        { header: t('archive.fields.due'), width: 14 },
        { header: t('archive.fields.worker'), width: 16 },
        { header: t('archive.fields.amount'), width: 14, format: 'money' },
      ],
      rows: rows.map((ticket) => [
        ticket.k,
        ticket.title,
        statusLabel(ticket),
        ticket.customer,
        ticket.plate,
        ticket.car,
        ticket.due && ticket.due !== '-' ? ticket.due : '',
        ticket.who ? workerChip(workerChips, ticket.who).n : '',
        ticket.amount || null,
      ]),
    });
  };

  return (
    <>
      <PageHeader
        title="archive.title"
        subtitle="archive.subtitle"
        count={tab === 'own' ? rows.length : undefined}
        icon={<IconClock />}
        actions={
          tab === 'own' && (
            <Button onClick={exportSheet} disabled={rows.length === 0}>
              ⭳ {t('archive.export')}
            </Button>
          )
        }
      />

      <Tabs tabs={TABS} selected={tab} onSelect={setTab} label="archive.title" />

      {tab === 'legacy' ? (
        <TabPanel id="legacy">
          <LegacyArchive onOpenTicket={onOpenTicket} />
        </TabPanel>
      ) : (
        <TabPanel id="own">
      <FilterBar>
        <Filter label="archive.search">
          {(id) => (
            <input
              id={id}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('archive.searchPlaceholder')}
            />
          )}
        </Filter>
        <Filter label="archive.status">
          {(id) => (
            <select id={id} value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
              <option value="all">{t('archive.statusAll')}</option>
              <option value="active">{t('archive.statusActive')}</option>
              <option value="archived">{t('archive.statusArchived')}</option>
              <option value="cancelled">{t('archive.cancelled')}</option>
            </select>
          )}
        </Filter>
      </FilterBar>

      <PagedTable
        columns={columns}
        rows={rows}
        rowKey={(ticket) => ticket.k}
        onRowClick={(ticket) => onOpenTicket(ticket.k)}
        empty={rows.length === 0 && tickets.length > 0 ? t('archive.noMatch') : t('archive.empty')}
        className={styles.table}
      />
        </TabPanel>
      )}
    </>
  );
}
