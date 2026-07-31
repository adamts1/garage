import type { Supplier } from '@garage/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/Button';
import { CrudForm } from '../../components/CrudForm';
import { TextField } from '../../components/Field';
import { PageHeader } from '../../components/PageHeader';
import { CellInput, RowActions, Table, type Column } from '../../components/Table';
import styles from './SuppliersPage.module.css';
import { blankSupplier, toDraft, useSuppliers, type SupplierDraft } from './useSuppliers';

export default function SuppliersPage() {
  const { t } = useTranslation();
  const { rows, create, update, remove } = useSuppliers();

  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<SupplierDraft>(blankSupplier);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [edit, setEdit] = useState<SupplierDraft>(blankSupplier);

  const draftField = (key: keyof SupplierDraft) => ({
    value: draft[key],
    onChange: (e: { target: { value: string } }) =>
      setDraft((prev) => ({ ...prev, [key]: e.target.value })),
  });

  const submitNew = async () => {
    if (await create(draft)) {
      setDraft(blankSupplier);
      setAdding(false);
    }
  };

  const submitEdit = async (id: string) => {
    if (await update(id, edit)) setEditingId(null);
  };

  /* One definition per column covering both states. The old page wrote the
     editing row and the reading row as two sibling <tr> branches, which is how
     they drifted: the edit row had lost a column. */
  const cell =
    (field: keyof SupplierDraft, read: (s: Supplier) => React.ReactNode, inputMode?: 'numeric') =>
    (s: Supplier) =>
      editingId === s.id ? (
        <CellInput
          value={edit[field]}
          inputMode={inputMode}
          aria-label={t(`suppliers.fields.${field}`)}
          onChange={(e) => setEdit((prev) => ({ ...prev, [field]: e.target.value }))}
        />
      ) : (
        read(s)
      );

  const columns: Column<Supplier>[] = [
    {
      key: 'name',
      header: 'suppliers.fields.name',
      sortValue: (s) => s.name,
      render: cell('name', (s) => <span className={styles.name}>{s.name}</span>),
    },
    {
      key: 'taxId',
      header: 'suppliers.fields.taxIdShort',
      sortValue: (s) => s.taxId ?? '',
      render: cell('taxId', (s) => s.taxId || t('common.none'), 'numeric'),
    },
    {
      key: 'phone',
      header: 'suppliers.fields.phone',
      render: cell('phone', (s) => s.phone || t('common.none')),
    },
    {
      key: 'email',
      header: 'suppliers.fields.email',
      render: cell('email', (s) => s.email || t('common.none')),
    },
    {
      key: 'address',
      header: 'suppliers.fields.address',
      render: cell('address', (s) => s.address || t('common.none')),
    },
    {
      key: 'actions',
      width: 170,
      render: (s) => (
        <RowActions>
          {editingId === s.id ? (
            <>
              <Button variant="primary" size="sm" onClick={() => void submitEdit(s.id)}>
                {t('common.save')}
              </Button>
              <Button size="sm" onClick={() => setEditingId(null)}>
                {t('common.cancel')}
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" onClick={() => { setEditingId(s.id); setEdit(toDraft(s)); }}>
                {t('common.edit')}
              </Button>
              <Button variant="ghostDanger" size="sm" onClick={() => void remove(s)}>
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
        title="suppliers.title"
        count={rows.length}
        actions={
          <Button variant="primary" onClick={() => setAdding((v) => !v)}>
            {adding ? t('common.cancel') : t('suppliers.add')}
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
          <TextField label="suppliers.fields.name" required autoFocus {...draftField('name')} />
          <TextField label="suppliers.fields.taxId" inputMode="numeric" {...draftField('taxId')} />
          <TextField label="suppliers.fields.phone" type="tel" {...draftField('phone')} />
          <TextField label="suppliers.fields.email" type="email" {...draftField('email')} />
          <TextField label="suppliers.fields.address" {...draftField('address')} />
        </CrudForm>
      )}

      <Table columns={columns} rows={rows} rowKey={(s) => s.id} emptyKey="suppliers.empty" />
    </>
  );
}
