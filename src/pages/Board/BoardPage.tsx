import {
  assignableWorkers, COLUMNS, shekel, workerChip, type Status, type Ticket, type Worker, type WorkerMap,
} from '@garage/shared';
import { useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/Button';
import { Table, type Column } from '../../components/Table';
import { IconBoard, IconTickets } from '../../icons';
import { epicChip } from '../../lib/epic';
import styles from './BoardPage.module.css';
import { BOARD_ATTR, CARD_ATTR, DROP_LIST_ATTR, useBoardDrag } from './useBoardDrag';

export interface BoardPageProps {
  tickets: Ticket[];
  setTickets: Dispatch<SetStateAction<Ticket[]>>;
  /** The garage's staff. Only active ones are offered as a filter. */
  workers: Worker[];
  /** Code → chip for rendering, retired workers included. */
  workerChips: WorkerMap;
  onNewTicket: () => void;
  onOpenTicket: (k: string) => void;
}


const PRIO_RANK: Record<string, number> = { urgent: 0, high: 1, med: 2, low: 3 };

export default function BoardPage({
  tickets, setTickets, workers, workerChips, onNewTicket, onOpenTicket,
}: BoardPageProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [view, setView] = useState<'board' | 'table'>('board');
  const [who, setWho] = useState<string | null>(null);

  const { drag, hover, onPointerDown } = useBoardDrag({ setTickets, onOpenTicket });

  const visible = useMemo(
    () =>
      tickets.filter((ticket) => {
        if (who && ticket.who !== who) return false;
        if (query) {
          const hay = (ticket.k + ticket.title + ticket.plate + ticket.car + ticket.customer)
            .toLowerCase();
          if (!hay.includes(query.toLowerCase())) return false;
        }
        return true;
      }),
    [tickets, who, query],
  );

  /* The last hand-rolled sort in the app is gone: these are the table's own
     columns, sorted by the table. `st`, `prio` and `who` sort on a rank or a
     resolved name rather than on what the cell draws — a status pill sorted as
     text would order by its Hebrew label, not by where it sits on the board. */
  const columns: Column<Ticket>[] = [
    {
      key: 'k',
      header: 'board.fields.key',
      sortValue: (ticket) => ticket.k,
      cellClassName: styles.tblKey,
      render: (ticket) => ticket.k,
    },
    {
      key: 'title',
      header: 'board.fields.title',
      sortValue: (ticket) => ticket.title,
      render: (ticket) => {
        const epic = epicChip(ticket.epic);
        return (
          <>
            <div className={styles.tblTitle}>{ticket.title || t('common.untitled')}</div>
            <span className={styles.epic} style={{ background: epic.bg, color: epic.c }}>
              {epic.t}
            </span>
            {ticket.blocked && <span className={styles.blocked}>⛔ {t('board.blocked')}</span>}
          </>
        );
      },
    },
    {
      key: 'customer',
      header: 'board.fields.customer',
      sortValue: (ticket) => ticket.customer,
      render: (ticket) => ticket.customer,
    },
    {
      key: 'plate',
      header: 'board.fields.plate',
      sortValue: (ticket) => ticket.plate,
      render: (ticket) => <span className={styles.plate}>{ticket.plate}</span>,
    },
    {
      key: 'car',
      header: 'board.fields.car',
      sortValue: (ticket) => ticket.car,
      render: (ticket) => ticket.car,
    },
    {
      key: 'st',
      header: 'board.fields.status',
      // Board order, not alphabetical order of the label.
      sortValue: (ticket) => COLUMNS.findIndex((c) => c.id === ticket.st),
      render: (ticket) => {
        const col = COLUMNS.find((c) => c.id === ticket.st);
        return (
          <span className={styles.stPill}>
            <span className={styles.dot} style={{ background: col?.dot }} />
            {col?.title}
          </span>
        );
      },
    },
    {
      key: 'who',
      header: 'board.fields.worker',
      sortValue: (ticket) => workerChip(workerChips, ticket.who).n,
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
      key: 'prio',
      header: 'board.fields.priority',
      width: 90,
      sortValue: (ticket) => PRIO_RANK[ticket.prio] ?? 99,
      render: (ticket) => t(`board.priority.${ticket.prio}`),
    },
    {
      key: 'amount',
      header: 'board.fields.amount',
      sortValue: (ticket) => ticket.amount,
      cellClassName: styles.amount,
      render: (ticket) => (ticket.amount ? shekel(ticket.amount) : '-'),
    },
  ];

  const card = (ticket: Ticket) => (
    <div
      key={ticket.k}
      className={`${styles.card}${drag?.k === ticket.k ? ` ${styles.hidden}` : ''}`}
      data-k={ticket.k}
      {...{ [CARD_ATTR]: '' }}
      onPointerDown={(e) => onPointerDown(e, ticket)}
    >
      <span className={styles.plate}>{ticket.plate}</span>
      <div className={styles.cardTitle}>{ticket.title}</div>
      <div className={styles.cardCar}>{ticket.car}</div>
    </div>
  );

  const boardView = (list: Ticket[], lane: string) => (
    <div className={styles.board} {...{ [BOARD_ATTR]: '' }}>
      {COLUMNS.map((col) => {
        const items = list.filter((ticket) => ticket.st === col.id);
        const over = Boolean(col.wip) && items.length > col.wip!;
        const dropping = hover?.col === (col.id as Status) && hover.lane === lane;

        const rendered: ReactNode[] = items.map(card);
        if (dropping && drag) {
          rendered.splice(
            hover.index,
            0,
            <div key="slot" className={styles.slot} style={{ height: drag.h }} />,
          );
        }

        return (
          <section key={col.id} className={`${styles.col}${over ? ` ${styles.wipOver}` : ''}`}>
            <header className={styles.colHead}>
              <span className={styles.dot} style={{ background: col.dot }} />
              {col.title}
              {over && <span className={styles.wip}>{t('board.wipExceeded')}</span>}
              <span className={styles.count}>
                {items.length}
                {col.wip ? `/${col.wip}` : ''}
              </span>
            </header>
            <div
              className={`${styles.list}${dropping ? ` ${styles.isTarget}` : ''}`}
              data-col={col.id}
              data-lane={lane}
              {...{ [DROP_LIST_ATTR]: '' }}
            >
              {rendered}
            </div>
          </section>
        );
      })}
    </div>
  );

  const ghost = drag ? tickets.find((ticket) => ticket.k === drag.k) : null;

  return (
    <div className={styles.jb}>
      <div className={styles.bar}>
        <div className={styles.avatarStack}>
          <button
            type="button"
            className={`${styles.avatar} ${styles.all}${who ? '' : ` ${styles.on}`}`}
            onClick={() => setWho(null)}
            title={t('board.allWorkers')}
          >
            👥
          </button>
          {/* Active workers only. A retired mechanic still shows on their old
              tickets, but filtering by one is noise on a live board. */}
          {assignableWorkers(workers).map((w) => (
            <button
              key={w.code}
              type="button"
              className={`${styles.avatar}${who === w.code ? ` ${styles.on}` : ''}`}
              style={{ background: w.color }}
              title={w.name}
              onClick={() => setWho(who === w.code ? null : w.code)}
            >
              {w.initials}
            </button>
          ))}
        </div>

        <div className={styles.spacer} />

        <div className={styles.viewToggle}>
          <button
            type="button"
            className={view === 'board' ? styles.on : undefined}
            onClick={() => setView('board')}
          >
            <IconBoard /> {t('board.viewBoard')}
          </button>
          <button
            type="button"
            className={view === 'table' ? styles.on : undefined}
            onClick={() => setView('table')}
          >
            <IconTickets /> {t('board.viewTable')}
          </button>
        </div>

        <Button variant="primary" onClick={onNewTicket}>
          {t('board.newTicket')} ＋
        </Button>
      </div>

      <div className={styles.filters}>
        <input
          className={styles.search}
          placeholder={t('board.searchPlaceholder')}
          aria-label={t('board.searchPlaceholder')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className={styles.spacer} />
        <span className={styles.shown}>
          {t('board.shown', { shown: visible.length, total: tickets.length })}
        </span>
      </div>

      {view === 'board' ? (
        boardView(visible, 'all')
      ) : (
        <Table
          columns={columns}
          rows={visible}
          rowKey={(ticket) => ticket.k}
          onRowClick={(ticket) => onOpenTicket(ticket.k)}
          defaultSort={{ key: 'k', dir: 1 }}
          emptyKey="board.empty"
          className={styles.tableWrap}
        />
      )}

      {/* The card that follows the pointer while dragging. */}
      {drag && ghost && (
        <div
          className={`${styles.card} ${styles.ghost}`}
          style={{ left: drag.x - drag.dx, top: drag.y - drag.dy, width: drag.w }}
        >
          <span className={styles.plate}>{ghost.plate}</span>
          <div className={styles.cardTitle}>{ghost.title}</div>
          <div className={styles.cardCar}>{ghost.car}</div>
        </div>
      )}
    </div>
  );
}
