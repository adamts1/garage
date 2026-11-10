import { customerKind, type Customer, type Ticket } from '@garage/shared';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Button } from '../../components/Button';
import { Pagination } from '../../components/Pagination';
import { SearchBar } from '../../components/SearchBar';
import { CrudForm } from '../../components/CrudForm';
import { SelectField, TextField } from '../../components/Field';
import { PageHeader } from '../../components/PageHeader';
import { CellInput, CellSelect, RowActions, Table, type Column } from '../../components/Table';
import { useLegacyVisits } from '../../lib/useLegacyVisits';
import { PER_PAGE_OPTIONS } from '../../lib/useServerPage';
import styles from './CustomersPage.module.css';
import {
  blankCustomer, CUSTOMER_KINDS, toDraft, useCustomers, type CustomerDraft,
} from './useCustomers';

export default function CustomersPage({ tickets }: { tickets: Ticket[] }) {
  const { t } = useTranslation();

  /* A customer's kind is stored as a code; this is where it becomes a word.
     The code is shared with the phone app, the Hebrew for it is this app's. */
  const kindLabel = (kind: string) => t(`customers.kinds.${customerKind(kind)}`);
  /* Searched by everything the counter is likely to have in hand: a name, a
     phone typed with or without hyphens, an email, a ת״ז, a city, or the plate
     of one of their cars — by the database, a page at a time. */
  const [query, setQuery] = useState('');
  const { rows, total, pager, loaded, searching, vehiclesByCustomer, create, update, remove } = useCustomers(query);

  /* Work orders per customer, cancelled ones included: every one of them keeps
     the customer on file (the database refuses the delete), so the button is
     disabled up front rather than left to fail. */
  const legacy = useLegacyVisits('customer', useMemo(() => rows.map((c) => c.id), [rows]));
  const ticketCount = useMemo(() => {
    const map = new Map<string, number>();
    const add = (id: string | null | undefined) => { if (id) map.set(id, (map.get(id) ?? 0) + 1); };
    for (const ticket of tickets) add(ticket.customerId);
    // Their cards from the previous system count too — and also keep them on file.
    for (const v of legacy) add(v.customerId);
    return map;
  }, [tickets, legacy]);


  /* One open panel at a time. Several would turn the table into a list of
     lists, and the reason to open one is to look at that customer's cars. */
  const [openVehicles, setOpenVehicles] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<CustomerDraft>(blankCustomer);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [edit, setEdit] = useState<CustomerDraft>(blankCustomer);

  const draftField = (key: keyof CustomerDraft) => ({
    value: draft[key] ?? '',
    onChange: (e: { target: { value: string } }) =>
      setDraft((prev) => ({ ...prev, [key]: e.target.value })),
  });

  const editProps = (key: keyof CustomerDraft) => ({
    value: edit[key] ?? '',
    'aria-label': t(`customers.fields.${key}`),
    onChange: (e: { target: { value: string } }) =>
      setEdit((prev) => ({ ...prev, [key]: e.target.value })),
  });

  const submitNew = async () => {
    if (await create(draft)) {
      setDraft(blankCustomer);
      setAdding(false);
    }
  };

  const cell =
    (
      field: keyof CustomerDraft,
      read: (c: Customer) => React.ReactNode,
      inputMode?: 'numeric',
    ) =>
    (c: Customer) =>
      editingId === c.id ? <CellInput inputMode={inputMode} {...editProps(field)} /> : read(c);

  const columns: Column<Customer>[] = [
    {
      key: 'name',
      header: 'customers.fields.name',
      render: cell('name', (c) => (
        <Link className={styles.name} to={`/customers/${c.id}`}>{c.name}</Link>
      )),
    },
    {
      key: 'phone',
      header: 'customers.fields.phone',
      render: cell('phone', (c) => c.phone || t('common.none')),
    },
    {
      key: 'email',
      header: 'customers.fields.email',
      render: cell('email', (c) => c.email || t('common.none')),
    },
    {
      key: 'id_number',
      header: 'customers.fields.id_number',
      render: cell('id_number', (c) => c.id_number || t('common.none'), 'numeric'),
    },
    {
      key: 'city',
      header: 'customers.fields.city',
      render: cell('city', (c) => c.city || t('common.none')),
    },
    {
      key: 'kind',
      header: 'customers.fields.kind',
      // Sorted by the label, not the code: 'business' before 'private' would put
      // the rows in an order that means nothing to anyone reading Hebrew.
      render: (c) =>
        editingId === c.id ? (
          <CellSelect {...editProps('kind')}>
            {CUSTOMER_KINDS.map((k) => (
              <option key={k} value={k}>{kindLabel(k)}</option>
            ))}
          </CellSelect>
        ) : (
          <span className={styles.kind}>{kindLabel(c.kind)}</span>
        ),
    },
    {
      key: 'vehicles',
      header: 'customers.fields.vehicles',
      width: 110,
      /* The count is the answer most of the time; the panel is for the rest.
         Disabled at zero rather than hidden, so the column reads as "no cars on
         file" instead of "this row is different". */
      render: (c) => {
        const cars = vehiclesByCustomer.get(c.id) ?? [];
        const open = openVehicles === c.id;
        return (
          <Button
            size="sm"
            disabled={cars.length === 0}
            aria-expanded={open}
            onClick={() => setOpenVehicles(open ? null : c.id)}
          >
            {cars.length ? `${cars.length} ${open ? '▲' : '▼'}` : t('common.none')}
          </Button>
        );
      },
    },
    {
      key: 'tickets',
      header: 'customers.fields.tickets',
      width: 100,
      render: (c) => ticketCount.get(c.id) ?? 0,
    },
    {
      key: 'actions',
      width: 170,
      render: (c) => (
        <RowActions>
          {editingId === c.id ? (
            <>
              <Button
                variant="primary"
                size="sm"
                onClick={async () => {
                  if (await update(c.id, edit)) setEditingId(null);
                }}
              >
                {t('common.save')}
              </Button>
              <Button size="sm" onClick={() => setEditingId(null)}>
                {t('common.cancel')}
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" onClick={() => { setEditingId(c.id); setEdit(toDraft(c)); }}>
                {t('common.edit')}
              </Button>
              <Button
                variant="ghostDanger"
                size="sm"
                disabled={(ticketCount.get(c.id) ?? 0) > 0}
                title={(ticketCount.get(c.id) ?? 0) > 0 ? t('customers.deleteBlocked') : undefined}
                onClick={() => void remove(c)}
              >
                {t('common.delete')}
              </Button>
            </>
          )}
        </RowActions>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="customers.title"
        count={total}
        actions={
          <Button variant="primary" onClick={() => setAdding((v) => !v)}>
            {adding ? t('common.cancel') : t('customers.add')}
          </Button>
        }
      />

      {adding && (
        <CrudForm
          onSubmit={() => void submitNew()}
          actions={
            <Button variant="primary" type="submit" disabled={!draft.name.trim()}>
              {t('common.save')}
            </Button>
          }
        >
          <TextField label="customers.fields.name" required autoFocus {...draftField('name')} />
          <TextField label="customers.fields.phone" type="tel" {...draftField('phone')} />
          <TextField label="customers.fields.email" type="email" {...draftField('email')} />
          <TextField label="customers.fields.id_number" inputMode="numeric" {...draftField('id_number')} />
          <TextField label="customers.fields.city" {...draftField('city')} />
          <SelectField label="customers.fields.kind" {...draftField('kind')}>
            {CUSTOMER_KINDS.map((k) => (
              <option key={k} value={k}>{kindLabel(k)}</option>
            ))}
          </SelectField>
        </CrudForm>
      )}

      <SearchBar value={query} onChange={setQuery} placeholder="customers.searchPlaceholder" />

      <Table
        columns={columns}
        rows={rows}
        rowKey={(c) => c.id}
        empty={!loaded || searching ? t('app.loading') : query.trim() ? t('customers.noMatch') : t('customers.empty')}
        renderExpanded={(c) =>
          openVehicles === c.id ? (
            <div className={styles.vehicles}>
              {(vehiclesByCustomer.get(c.id) ?? []).map((v) => (
                <div key={v.id} className={styles.vehicle}>
                  <b className={styles.plate}>{v.plate}</b>
                  <span className={styles.vehicleName}>
                    {[v.manufacturer, v.model].filter(Boolean).join(' ') || t('common.none')}
                  </span>
                  <span className={styles.vehicleMeta}>
                    {[
                      v.year,
                      v.km && t('newTicket.kmValue', { km: v.km }),
                      v.vehicle_code,
                    ].filter(Boolean).join(' · ')}
                  </span>
                </div>
              ))}
            </div>
          ) : null
        }
      />

      <Pagination {...pager} perPageOptions={PER_PAGE_OPTIONS} />
    </>
  );
}
