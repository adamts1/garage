import {
  customerKind, getCustomer, isCancelled, shekel, subscribeToTable, type CustomerWithVehicles, type Ticket,
} from '@garage/shared';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { Button } from '../../components/Button';
import { Filter, FilterBar } from '../../components/FilterBar';
import { Pill, type PillTone } from '../../components/Pill';
import { Table, type Column } from '../../components/Table';
import { TabPanel, Tabs, type TabDef } from '../../components/Tabs';
import { IconPrint } from '../../icons';
import { printCustomerHistory, warnIfBlocked } from '../../lib/print';
import { isConfigured } from '../../lib/supabase';
import { useBurstReload } from '../../lib/useServerPage';
import styles from './CustomerPage.module.css';

const onCustomersOrCars = (onChange: () => void) => {
  const offCustomers = subscribeToTable('customers', onChange);
  const offVehicles = subscribeToTable('vehicles', onChange);
  return () => { offCustomers(); offVehicles(); };
};

type TabId = 'tickets' | 'vehicles';
const TABS: readonly TabDef<TabId>[] = [
  { id: 'tickets', label: 'customer.tabs.tickets' },
  { id: 'vehicles', label: 'customer.tabs.vehicles' },
];

type StatusFilter = 'all' | 'open' | 'closed' | 'cancelled';
const FILTERS: readonly StatusFilter[] = ['all', 'open', 'closed', 'cancelled'];

const matches = (f: StatusFilter, ticket: Ticket) =>
  f === 'all' ? true
  : f === 'cancelled' ? isCancelled(ticket)
  : f === 'open' ? ticket.st === 'todo' || ticket.st === 'appr'
  : ticket.st === 'done' || ticket.st === 'paid';

const TONE: Record<Ticket['st'], PillTone> = {
  todo: 'neutral', appr: 'warn', done: 'ok', paid: 'ok', cancelled: 'danger',
};

/* GAR-12 before GAR-9: the number is what the rule is about, so it is sorted
   as a number, newest first. */
const ticketNo = (ticket: Ticket) => Number(ticket.k.split('-')[1]) || 0;

export interface CustomerPageProps {
  /** Every ticket, cancelled ones included — this page is the full record. */
  tickets: Ticket[];
  onOpenTicket: (k: string) => void;
}

/** One customer, and every work order ever opened for them.
 *
 *  The list is the regulatory view: once a ticket is numbered it is never
 *  deleted, so a cancelled one is shown here with its reason rather than
 *  filtered out. "All" is the default for that reason. Tickets are matched on
 *  customer_id, never on the name typed into them. */
export default function CustomerPage({ tickets, onOpenTicket }: CustomerPageProps) {
  const { t } = useTranslation();
  const { id } = useParams();
  /* This one customer and their cars — not the whole customer list, which
     stopped at 1000 rows and moved the table to show one record. */
  const [customer, setCustomer] = useState<CustomerWithVehicles | null>(null);
  const [loaded, setLoaded] = useState(false);
  const load = useCallback(() => {
    if (!isConfigured || !id) { setLoaded(true); return; }
    getCustomer(id).then(setCustomer).catch(() => {}).finally(() => setLoaded(true));
  }, [id]);
  useEffect(load, [load]);
  useBurstReload(onCustomersOrCars, load);
  const [tab, setTab] = useState<TabId>('tickets');
  const [filter, setFilter] = useState<StatusFilter>('all');


  const theirs = useMemo(
    () => tickets.filter((ticket) => ticket.customerId === id).sort((a, b) => ticketNo(b) - ticketNo(a)),
    [tickets, id],
  );
  const shown = useMemo(() => theirs.filter((ticket) => matches(filter, ticket)), [theirs, filter]);
  const counts = useMemo(
    () => Object.fromEntries(FILTERS.map((f) => [f, theirs.filter((ticket) => matches(f, ticket)).length])),
    [theirs],
  ) as Record<StatusFilter, number>;

  if (!customer) {
    return loaded ? (
      <div className="db-error">
        {t('customer.notFound')} <Link to="/customers">{t('customer.backToList')}</Link>
      </div>
    ) : (
      <div className="db-loading">{t('app.loading')}</div>
    );
  }

  const cars = customer.vehicles ?? [];

  const columns: Column<Ticket>[] = [
    {
      key: 'k',
      header: 'customer.fields.key',
      width: 96,
      sortValue: ticketNo,
      cellClassName: styles.key,
      render: (ticket) => ticket.k,
    },
    {
      key: 'created',
      header: 'customer.fields.created',
      width: 110,
      sortValue: (ticket) => ticket.createdAtISO ?? '',
      render: (ticket) => ticket.createdAt ?? '—',
    },
    {
      key: 'title',
      header: 'customer.fields.title',
      render: (ticket) => ticket.title || t('common.untitled'),
    },
    {
      key: 'plate',
      header: 'customer.fields.plate',
      render: (ticket) => (ticket.plate && ticket.plate !== '-' ? <span className={styles.plate}>{ticket.plate}</span> : '—'),
    },
    {
      key: 'status',
      header: 'customer.fields.status',
      render: (ticket) => (
        <>
          <Pill tone={TONE[ticket.st]}>{t(`customer.status.${ticket.st}`)}</Pill>
          {isCancelled(ticket) && (
            <div className={styles.reason}>
              {ticket.cancelledAt && new Date(ticket.cancelledAt).toLocaleDateString('he-IL')}
              {ticket.cancelReason && ` · ${ticket.cancelReason}`}
            </div>
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

  return (
    <>
      <div className={styles.head}>
        <Link className={styles.back} to="/customers">→ {t('customer.backToList')}</Link>
        <div className={styles.titleRow}>
          <h2 className={styles.name}>
            {customer.name}
            <span className={styles.kind}>{t(`customers.kinds.${customerKind(customer.kind)}`)}</span>
          </h2>
          {/* Every visit, whatever the filter below shows — but never a
              cancelled ticket: the history is the work that was done. */}
          <Button onClick={() => warnIfBlocked(printCustomerHistory(customer, theirs))}>
            <IconPrint /> {t('customer.printHistory')}
          </Button>
        </div>
        <dl className={styles.facts}>
          <div><dt>{t('customers.fields.phone')}</dt><dd dir="ltr">{customer.phone || t('common.none')}</dd></div>
          <div><dt>{t('customers.fields.id_number')}</dt><dd dir="ltr">{customer.id_number || t('common.none')}</dd></div>
          <div><dt>{t('customers.fields.email')}</dt><dd dir="ltr">{customer.email || t('common.none')}</dd></div>
          <div><dt>{t('customers.fields.city')}</dt><dd>{customer.city || t('common.none')}</dd></div>
        </dl>
      </div>

      <Tabs tabs={TABS} selected={tab} onSelect={setTab} label="customer.tabs.label" />

      {tab === 'tickets' ? (
        <TabPanel id="tickets">
          <FilterBar>
            <Filter label="customer.filter">
              {(fid) => (
                <select id={fid} value={filter} onChange={(e) => setFilter(e.target.value as StatusFilter)}>
                  {FILTERS.map((f) => (
                    <option key={f} value={f}>{t(`customer.filters.${f}`, { count: counts[f] })}</option>
                  ))}
                </select>
              )}
            </Filter>
          </FilterBar>
          <Table
            columns={columns}
            rows={shown}
            rowKey={(ticket) => ticket.k}
            onRowClick={(ticket) => onOpenTicket(ticket.k)}
            empty={theirs.length === 0 ? t('customer.noTickets') : t('customer.noMatch')}
            className={styles.table}
          />
        </TabPanel>
      ) : (
        <TabPanel id="vehicles">
          {cars.length === 0 ? (
            <p className={styles.empty}>{t('customer.noVehicles')}</p>
          ) : (
            <div className={styles.vehicles}>
              {cars.map((v) => (
                <div key={v.id} className={styles.vehicle}>
                  {/* The car's own page: its whole history, every owner's visits. */}
                  {v.car_id
                    ? <Link className={styles.plate} to={`/cars/${v.car_id}`}><b>{v.plate}</b></Link>
                    : <b className={styles.plate}>{v.plate}</b>}
                  <span>{[v.manufacturer, v.model].filter(Boolean).join(' ') || t('common.none')}</span>
                  <span className={styles.meta}>
                    {[v.year, v.km && t('newTicket.kmValue', { km: v.km }), v.vehicle_code]
                      .filter(Boolean).join(' · ')}
                  </span>
                </div>
              ))}
            </div>
          )}
        </TabPanel>
      )}
    </>
  );
}
