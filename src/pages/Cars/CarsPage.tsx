import { listCars, plateKey, type Car, type CarOwner, type Ticket } from '@garage/shared';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Button } from '../../components/Button';
import { PageHeader } from '../../components/PageHeader';
import { RowActions, Table, type Column } from '../../components/Table';
import { IconPrint } from '../../icons';
import { printCarHistory, warnIfBlocked } from '../../lib/print';
import { isConfigured } from '../../lib/supabase';
import { showError, useAppDispatch } from '../../store';
import styles from './CarsPage.module.css';

type Row = Car & { owners: CarOwner[]; visits: number; lastVisit: string };

/** Every car in the garage — one row per plate, whoever drives it. Each opens
 *  the car's page, which is its whole history (see CarPage). */
export default function CarsPage({ tickets }: { tickets: Ticket[] }) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const [cars, setCars] = useState<(Car & { owners: CarOwner[] })[]>([]);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!isConfigured) return;
    listCars().then(setCars).catch((e) => dispatch(showError(e)));
  }, [dispatch]);

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

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    const qPlate = plateKey(q);
    return rows.filter((c) =>
      (qPlate && plateKey(c.plate).includes(qPlate))
      || [c.manufacturer, c.model].some((x) => x?.toLowerCase().includes(q))
      || c.owners.some((o) => o.name.toLowerCase().includes(q)));
  }, [rows, query]);

  const columns: Column<Row>[] = [
    {
      key: 'plate',
      header: 'cars.fields.plate',
      width: 130,
      sortValue: (c) => plateKey(c.plate),
      render: (c) => <Link className={styles.plate} to={`/cars/${c.id}`}>{c.plate}</Link>,
    },
    {
      key: 'make',
      header: 'cars.fields.make',
      sortValue: (c) => [c.manufacturer, c.model].filter(Boolean).join(' '),
      render: (c) => [c.manufacturer, c.model].filter(Boolean).join(' ') || <span className={styles.muted}>—</span>,
    },
    { key: 'year', header: 'cars.fields.year', width: 80, sortValue: (c) => c.year ?? '', render: (c) => c.year || '—' },
    {
      key: 'owners',
      header: 'cars.fields.owners',
      render: (c) => c.owners.length
        ? c.owners.map((o, i) => (
            <span key={o.id}>{i > 0 && ' · '}<Link className="kv-link" to={`/customers/${o.id}`}>{o.name}</Link></span>
          ))
        : <span className={styles.muted}>—</span>,
    },
    { key: 'visits', header: 'cars.fields.visits', width: 90, sortValue: (c) => c.visits, render: (c) => c.visits },
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
      <PageHeader title="cars.title" count={rows.length} />
      <div className={styles.filters}>
        <input
          className={styles.search}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('cars.searchPlaceholder')}
          aria-label={t('cars.searchPlaceholder')}
        />
        {query.trim() && <Button onClick={() => setQuery('')}>{t('common.reset')}</Button>}
      </div>
      <Table
        columns={columns}
        rows={shown}
        rowKey={(c) => c.id}
        empty={rows.length === 0 ? t('cars.empty') : t('cars.noMatch')}
      />
    </>
  );
}
