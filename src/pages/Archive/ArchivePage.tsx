import { EPICS, workerChip, type Ticket, type WorkerMap } from '@garage/shared';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Filter, FilterBar } from '../../components/FilterBar';
import { PageHeader } from '../../components/PageHeader';
import { Table, type Column } from '../../components/Table';
import { IconClock } from '../../icons';
import styles from './ArchivePage.module.css';

export interface ArchivePageProps {
  /** Already filtered to archived tickets — paid, and aged past the cutoff. */
  tickets: Ticket[];
  /** Code → chip. Retired workers included: the archive is entirely history, so
   *  it is the view that most needs them to keep resolving. */
  workerChips: WorkerMap;
  onOpenTicket: (k: string) => void;
}

const shekel = (n: number) => '₪' + n.toLocaleString('he-IL');

/* `epic` is typed against EPICS but arrives from the database, so the type is a
   promise the row cannot keep: a value added server-side, or an old row from
   before a rename, indexes to undefined and taking .bg off it white-screens the
   whole archive. Falling back shows the raw value, which is more use than a
   blank page for working out what it is. */
const epicChip = (epic: Ticket['epic']) =>
  EPICS[epic] ?? { t: String(epic), bg: 'var(--surface-2)', c: 'var(--muted-d)' };

export default function ArchivePage({ tickets, workerChips, onOpenTicket }: ArchivePageProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const kept = q
      ? tickets.filter((ticket) =>
          (ticket.k + ticket.title + ticket.plate + ticket.car + ticket.customer)
            .toLowerCase()
            .includes(q),
        )
      : tickets;

    /* Newest settled first, done here rather than through the table's own sort:
       the ordering is on createdAtISO, which no column renders, and a
       `defaultSort` naming a key with no column silently does nothing. Clicking
       a header still re-sorts from here. */
    return [...kept].sort((a, b) => (b.createdAtISO ?? '').localeCompare(a.createdAtISO ?? ''));
  }, [tickets, query]);

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
            <div className={styles.title}>{ticket.title}</div>
            <span className={styles.epic} style={{ background: epic.bg, color: epic.c }}>
              {epic.t}
            </span>
          </>
        );
      },
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

  return (
    <>
      <PageHeader
        title="archive.title"
        subtitle="archive.subtitle"
        count={rows.length}
        icon={<IconClock />}
      />

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
      </FilterBar>

      <Table
        columns={columns}
        rows={rows}
        rowKey={(ticket) => ticket.k}
        onRowClick={(ticket) => onOpenTicket(ticket.k)}
        empty={rows.length === 0 && tickets.length > 0 ? t('archive.noMatch') : t('archive.empty')}
        className={styles.table}
      />
    </>
  );
}
