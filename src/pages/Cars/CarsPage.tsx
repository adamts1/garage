import { searchCars, subscribeToTable, type Car, type CarOwner, type Ticket } from '@garage/shared';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Button } from '../../components/Button';
import { Pagination } from '../../components/Pagination';
import { SearchBar } from '../../components/SearchBar';
import { PageHeader } from '../../components/PageHeader';
import { RowActions, Table, type Column } from '../../components/Table';
import { IconPrint } from '../../icons';
import { printCarHistory, warnIfBlocked } from '../../lib/print';
import { PER_PAGE_OPTIONS, useBurstReload, useServerPage } from '../../lib/useServerPage';
import { showError, useAppDispatch } from '../../store';
import styles from './CarsPage.module.css';

type Row = Car & { owners: CarOwner[]; visits: number; lastVisit: string };

const onCarsChange = (onChange: () => void) => {
  const offCars = subscribeToTable('vehicles', onChange);
  return () => { offCars(); };
};

/** Every car in the garage — one row per plate, whoever drives it. Each opens
 *  the car's page, which is its whole history (see CarPage). */
export default function CarsPage({ tickets }: { tickets: Ticket[] }) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  /* Searched by plate, make, model or an owner's name — by the database, one
     page at a time. It used to load every car and filter here, which PostgREST
     capped at 1000. */
  const [query, setQuery] = useState('');
  const { rows: cars, total, pager, loaded, searching, error, reload } = useServerPage(searchCars, query);
  useEffect(() => { if (error) dispatch(showError(error)); }, [error, dispatch]);
  useBurstReload(onCarsChange, reload);

  /* Visits are counted from the tickets the shell already holds, cancelled ones
     included — the same record the car page lists. */
  const rows: Row[] = useMemo(() => {
    const visits = new Map<string, { n: number; last: string; lastLabel: string }>();
    for (const ticket of tickets) {
      if (!ticket.carId) continue;
      const v = visits.get(ticket.carId) ?? { n: 0, last: '', lastLabel: '' };
      v.n += 1;
      const iso = ticket.createdAtISO ?? '';
      if (iso > v.last) { v.last = iso; v.lastLabel = ticket.createdAt ?? ''; }
      visits.set(ticket.carId, v);
    }
    return cars.map((c) => ({
      ...c,
      visits: visits.get(c.id)?.n ?? 0,
      lastVisit: visits.get(c.id)?.lastLabel ?? '',
    }));
  }, [cars, tickets]);


  const columns: Column<Row>[] = [
    {
      key: 'plate',
      header: 'cars.fields.plate',
      width: 130,
      render: (c) => <Link className={styles.plate} to={`/cars/${c.id}`}>{c.plate}</Link>,
    },
    {
      key: 'make',
      header: 'cars.fields.make',
      render: (c) => [c.manufacturer, c.model].filter(Boolean).join(' ') || <span className={styles.muted}>—</span>,
    },
    { key: 'year', header: 'cars.fields.year', width: 80, render: (c) => c.year || '—' },
    {
      key: 'owners',
      header: 'cars.fields.owners',
      render: (c) => c.owners.length
        ? c.owners.map((o, i) => (
            <span key={o.id}>{i > 0 && ' · '}<Link className="kv-link" to={`/customers/${o.id}`}>{o.name}</Link></span>
          ))
        : <span className={styles.muted}>—</span>,
    },
    { key: 'visits', header: 'cars.fields.visits', width: 90, render: (c) => c.visits },
    { key: 'lastVisit', header: 'cars.fields.lastVisit', width: 120, render: (c) => c.lastVisit || '—' },
    {
      key: 'print',
      width: 56,
      render: (c) => (
        <RowActions>
          <Button
            variant="ghost"
            size="sm"
            title={t('car.printHistory')}
            aria-label={t('car.printHistory')}
            onClick={() => warnIfBlocked(printCarHistory(c, c.owners, tickets.filter((x) => x.carId === c.id)))}
          >
            <IconPrint />
          </Button>
        </RowActions>
      ),
    },
  ];

  return (
    <>
      <PageHeader title="cars.title" count={total} />
      <SearchBar value={query} onChange={setQuery} placeholder="cars.searchPlaceholder" />
      <Table
        columns={columns}
        rows={rows}
        rowKey={(c) => c.id}
        empty={!loaded || searching ? t('app.loading') : query.trim() ? t('cars.noMatch') : t('cars.empty')}
      />
      <Pagination {...pager} perPageOptions={PER_PAGE_OPTIONS} />
    </>
  );
}
