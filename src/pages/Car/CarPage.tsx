import {
  getCar, isCancelled, listCarLegacyHistory, shekel, type Car, type CarOwner, type Ticket,
} from '@garage/shared';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Button } from '../../components/Button';
import { Pill, type PillTone } from '../../components/Pill';
import { Table, type Column } from '../../components/Table';
import { IconPrint } from '../../icons';
import { printCarHistory, warnIfBlocked } from '../../lib/print';
import { isConfigured } from '../../lib/supabase';
import styles from '../Customers/CustomerPage.module.css';

const TONE: Record<Ticket['st'], PillTone> = {
  todo: 'neutral', appr: 'warn', done: 'ok', paid: 'ok', cancelled: 'danger',
};

const ticketNo = (ticket: Ticket) => Number(ticket.k.split('-')[1]) || 0;

/* Newest visit first. The garage's own numbers and the previous system's are
   two sequences, so they are ordered by when the visit was, not by number. */
const byVisit = (a: Ticket, b: Ticket) =>
  (b.createdAtISO ?? '').localeCompare(a.createdAtISO ?? '') || ticketNo(b) - ticketNo(a);

export interface CarPageProps {
  /** Every ticket, cancelled ones included — this page is the car's full record. */
  tickets: Ticket[];
  onOpenTicket: (k: string) => void;
}

/** One car and every work order for it, whoever brought it in.
 *
 *  History is per car (2026-11-04): a plate driven by a husband, a wife and a
 *  son is one car with one history, so the tickets are matched on car_id —
 *  which the database resolves from the plate — and never on the customer.
 *  Each row says whose ticket it was, and the km read on that visit. */
export default function CarPage({ tickets, onOpenTicket }: CarPageProps) {
  const { t } = useTranslation();
  const { id } = useParams();
  const navigate = useNavigate();
  const [car, setCar] = useState<Car | null>(null);
  const [owners, setOwners] = useState<CarOwner[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [legacy, setLegacy] = useState<Ticket[]>([]);

  useEffect(() => {
    if (!isConfigured || !id) { setLoaded(true); return; }
    let alive = true;
    getCar(id)
      .then((found) => {
        if (!alive) return;
        setCar(found?.car ?? null);
        setOwners(found?.owners ?? []);
      })
      .catch(() => {})
      .finally(() => alive && setLoaded(true));
    return () => { alive = false; };
  }, [id]);

  // Work orders from the previous system: not in the store, read-only, here only.
  useEffect(() => {
    if (!isConfigured || !id) return;
    let alive = true;
    listCarLegacyHistory(id)
      .then((rows) => alive && setLegacy(rows))
      .catch(() => {});
    return () => { alive = false; };
  }, [id]);

  const history = useMemo(
    () => [...tickets.filter((ticket) => ticket.carId === id), ...legacy].sort(byVisit),
    [tickets, legacy, id],
  );

  if (!car) {
    return loaded ? (
      <div className="db-error">{t('car.notFound')}</div>
    ) : (
      <div className="db-loading">{t('app.loading')}</div>
    );
  }

  const columns: Column<Ticket>[] = [
    { key: 'k', header: 'customer.fields.key', width: 96, sortValue: ticketNo, cellClassName: styles.key, render: (ticket) => ticket.k },
    {
      key: 'created',
      header: 'customer.fields.created',
      width: 110,
      sortValue: (ticket) => ticket.createdAtISO ?? '',
      render: (ticket) => ticket.createdAt ?? '—',
    },
    { key: 'customer', header: 'car.fields.customer', render: (ticket) => ticket.customer || '—' },
    { key: 'title', header: 'customer.fields.title', render: (ticket) => ticket.title || t('common.untitled') },
    { key: 'km', header: 'car.fields.km_visit', width: 96, render: (ticket) => ticket.km || '—' },
    {
      key: 'status',
      header: 'customer.fields.status',
      render: (ticket) => ticket.legacy ? (
        <Pill tone="neutral">{t('car.legacy.badge')}</Pill>
      ) : (
        <>
          <Pill tone={TONE[ticket.st]}>{t(`customer.status.${ticket.st}`)}</Pill>
          {isCancelled(ticket) && ticket.cancelReason && (
            <div className={styles.reason}>{ticket.cancelReason}</div>
          )}
        </>
      ),
    },
    {
      key: 'amount',
      header: 'customer.fields.amount',
      width: 120,
      sortValue: (ticket) => ticket.amount,
      render: (ticket) => (ticket.amount ? shekel(ticket.amount) : '—'),
    },
  ];

  const make = [car.manufacturer, car.model].filter(Boolean).join(' ');

  return (
    <>
      <div className={styles.head}>
        <button type="button" className={`${styles.back} btn ghost`} onClick={() => navigate(-1)}>
          → {t('car.back')}
        </button>
        <div className={styles.titleRow}>
          <h2 className={styles.name}>
            <span className={styles.plate} dir="ltr">{car.plate}</span>
            {make && <span className={styles.kind}>{make}</span>}
          </h2>
          {/* Every visit, whoever brought the car in — never a cancelled one. */}
          <Button onClick={() => warnIfBlocked(printCarHistory(car, owners, history))}>
            <IconPrint /> {t('car.printHistory')}
          </Button>
        </div>
        <dl className={styles.facts}>
          <div><dt>{t('car.fields.make')}</dt><dd>{make || t('common.none')}</dd></div>
          <div><dt>{t('car.fields.year')}</dt><dd dir="ltr">{car.year || t('common.none')}</dd></div>
          <div><dt>{t('car.fields.km')}</dt><dd dir="ltr">{car.km || t('common.none')}</dd></div>
          <div><dt>{t('car.fields.vehicleCode')}</dt><dd dir="ltr">{car.vehicle_code || t('common.none')}</dd></div>
        </dl>
        <dl className={styles.facts}>
          <div>
            <dt>{t('car.owners')}</dt>
            <dd>
              {owners.length
                ? owners.map((o, i) => (
                    <span key={o.id}>
                      {i > 0 && ' · '}
                      <Link className="kv-link" to={`/customers/${o.id}`}>{o.name}</Link>
                    </span>
                  ))
                : t('car.noOwners')}
            </dd>
          </div>
        </dl>
      </div>

      <h3 className="section-title">{t('car.history')}</h3>
      <Table
        columns={columns}
        rows={history}
        rowKey={(ticket) => ticket.k}
        onRowClick={(ticket) => onOpenTicket(ticket.k)}
        empty={t('car.noTickets')}
        className={styles.table}
      />
    </>
  );
}
