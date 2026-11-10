import { searchCars, subscribeToTable, type Car, type CarOwner, type Ticket } from '@garage/shared';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Pagination } from '../../components/Pagination';
import { SearchBar } from '../../components/SearchBar';
import { PageHeader } from '../../components/PageHeader';
import { Table, type Column } from '../../components/Table';
import { useLegacyVisits } from '../../lib/useLegacyVisits';
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
     included — the same record the car page lists — plus this page's cars'
     cards from the previous system, which the shell does not hold. */
  const legacy = useLegacyVisits('car', useMemo(() => cars.map((c) => c.id), [cars]));
  const rows: Row[] = useMemo(() => {
    const visits = new Map<string, { n: number; last: string; lastLabel: string }>();
    const add = (carId: string | null | undefined, iso: string) => {
      if (!carId) return;
      const v = visits.get(carId) ?? { n: 0, last: '', lastLabel: '' };
      v.n += 1;
      if (iso > v.last) { v.last = iso; v.lastLabel = iso ? new Date(iso).toLocaleDateString('he-IL') : ''; }
      visits.set(carId, v);
    };
    for (const ticket of tickets) add(ticket.carId, ticket.createdAtISO ?? '');
    for (const v of legacy) add(v.carId, v.at);
    return cars.map((c) => ({
      ...c,
      visits: visits.get(c.id)?.n ?? 0,
      lastVisit: visits.get(c.id)?.lastLabel ?? '',
    }));
  }, [cars, tickets, legacy]);


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
