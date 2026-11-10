import {
  getTicketByKey, partLineTotal, shekel, type PartRow, type Ticket,
} from '@garage/shared';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { Pill } from '../../components/Pill';
import { Table, type Column } from '../../components/Table';
import { isConfigured } from '../../lib/supabase';
import styles from '../Customers/CustomerPage.module.css';

/** A work order imported from the garage's previous system (RB-…), opened on
 *  its own: read-only, with its lines as that system recorded them.
 *
 *  Imported cards are not in the board's list (listTickets leaves them out),
 *  so a key that is not there is asked of the database here. A key that is
 *  neither — a typo, another garage's link — says so. */
export default function LegacyTicketPage({ ticketKey }: { ticketKey: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!isConfigured) { setLoaded(true); return; }
    let alive = true;
    setLoaded(false);
    getTicketByKey(ticketKey)
      .then((found) => alive && setTicket(found))
      .catch(() => {})
      .finally(() => alive && setLoaded(true));
    return () => { alive = false; };
  }, [ticketKey]);

  if (!loaded) return <div className="db-loading">{t('app.loading')}</div>;
  if (!ticket?.legacy) {
    return (
      <div className="db-error">
        {t('app.ticketNotFound', { key: ticketKey })} <Link to="/">{t('app.backToBoard')}</Link>
      </div>
    );
  }

  const parts = (ticket.works ?? []).flatMap((w) => w.items);
  const notes = [ticket.notes, ...(ticket.works ?? []).map((w) => w.notes)].filter(Boolean);
  const net = parts.reduce((s, p) => s + partLineTotal(p), 0);
  const columns: Column<PartRow>[] = [
    { key: 'sku', header: 'car.legacy.sku', width: 140, render: (p) => <span dir="ltr">{p.sku || '—'}</span> },
    { key: 'name', header: 'car.legacy.line', render: (p) => p.name },
    { key: 'qty', header: 'car.legacy.qty', width: 70, render: (p) => p.qty },
    { key: 'price', header: 'car.legacy.price', width: 100, render: (p) => shekel(p.price) },
    { key: 'discount', header: 'car.legacy.discount', width: 80, render: (p) => (p.discount ? `${p.discount}%` : '—') },
    { key: 'total', header: 'car.legacy.total', width: 110, render: (p) => shekel(partLineTotal(p)) },
  ];

  return (
    <>
      <div className={styles.head}>
        <button type="button" className={`${styles.back} btn ghost`} onClick={() => navigate(-1)}>
          → {t('car.back')}
        </button>
        <div className={styles.titleRow}>
          <h2 className={styles.name}>
            <span className={styles.plate} dir="ltr">{ticket.k}</span>
            <span className={styles.kind}>{ticket.title || t('common.untitled')}</span>
          </h2>
          <Pill tone="neutral">{t('car.legacy.badge')}</Pill>
        </div>
        <p className={styles.legacyNote}>{t('car.legacy.note', { number: ticket.legacy.number })}</p>
        <dl className={styles.facts}>
          <div><dt>{t('customer.fields.created')}</dt><dd>{ticket.createdAt ?? '—'}</dd></div>
          <div>
            <dt>{t('car.fields.customer')}</dt>
            <dd>
              {ticket.customerId
                ? <Link className="kv-link" to={`/customers/${ticket.customerId}`}>{ticket.customer || '—'}</Link>
                : ticket.customer || '—'}
            </dd>
          </div>
          <div>
            <dt>{t('cars.fields.plate')}</dt>
            <dd dir="ltr">
              {ticket.carId
                ? <Link className="kv-link" to={`/cars/${ticket.carId}`}>{ticket.plate}</Link>
                : ticket.plate || '—'}
            </dd>
          </div>
          <div><dt>{t('car.fields.km_visit')}</dt><dd dir="ltr">{ticket.km || '—'}</dd></div>
          <div><dt>{t('car.legacy.net')}</dt><dd>{shekel(net)}</dd></div>
          <div><dt>{t('car.legacy.gross')}</dt><dd>{shekel(ticket.amount)}</dd></div>
        </dl>
        {notes.map((n, i) => <p key={i} className={styles.legacyNote}>{n}</p>)}
      </div>
      <Table columns={columns} rows={parts} rowKey={(_, i) => String(i)} empty={t('car.legacy.noLines')} />
    </>
  );
}
