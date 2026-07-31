import type { Customer } from '@garage/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/Button';
import { CrudForm } from '../../components/CrudForm';
import { SelectField, TextField } from '../../components/Field';
import { PageHeader } from '../../components/PageHeader';
import { CellInput, CellSelect, RowActions, Table, type Column } from '../../components/Table';
import styles from './CustomersPage.module.css';
import {
  blankCustomer, CUSTOMER_KINDS, toDraft, useCustomers, type CustomerDraft,
} from './useCustomers';

export default function CustomersPage() {
  const { t } = useTranslation();
  const { rows, create, update, remove } = useCustomers();

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
      sortValue: (c) => c.name,
      render: cell('name', (c) => <span className={styles.name}>{c.name}</span>),
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
      sortValue: (c) => c.city ?? '',
      render: cell('city', (c) => c.city || t('common.none')),
    },
    {
      key: 'kind',
      header: 'customers.fields.kind',
      sortValue: (c) => c.kind,
      render: (c) =>
        editingId === c.id ? (
          <CellSelect {...editProps('kind')}>
            {CUSTOMER_KINDS.map((k) => <option key={k}>{k}</option>)}
          </CellSelect>
        ) : (
          <span className={styles.kind}>{c.kind}</span>
        ),
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
              <Button variant="ghostDanger" size="sm" onClick={() => void remove(c)}>
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
        count={rows.length}
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
            {CUSTOMER_KINDS.map((k) => <option key={k}>{k}</option>)}
          </SelectField>
        </CrudForm>
      )}

      <Table columns={columns} rows={rows} rowKey={(c) => c.id} emptyKey="customers.empty" />
    </>
  );
}
