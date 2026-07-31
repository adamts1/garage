import type { Supplier } from '@garage/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/Button';
import { TextField } from '../../components/Field';
import { Table, type Column } from '../../components/Table';
import styles from './SuppliersPage.module.css';
import { blankSupplier, toDraft, useSuppliers, type SupplierDraft } from './useSuppliers';

export default function SuppliersPage() {
  const { t } = useTranslation();
  const { rows, create, update, remove } = useSuppliers();

  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<SupplierDraft>(blankSupplier);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [edit, setEdit] = useState<SupplierDraft>(blankSupplier);

  const setDraftField = (key: keyof SupplierDraft) => (e: { target: { value: string } }) =>
    setDraft((prev) => ({ ...prev, [key]: e.target.value }));

  const setEditField = (key: keyof SupplierDraft) => (e: { target: { value: string } }) =>
    setEdit((prev) => ({ ...prev, [key]: e.target.value }));

  const submitNew = async () => {
    if (await create(draft)) {
      setDraft(blankSupplier);
      setAdding(false);
    }
  };

  const submitEdit = async (id: string) => {
    if (await update(id, edit)) setEditingId(null);
  };

  /* An editable cell and a read-only one, chosen per row. Written once here
     rather than as two near-identical <tr> branches, which is what the old page
     did and why the two drifted apart by two columns. */
  const cell = (
    field: keyof SupplierDraft,
    render: (s: Supplier) => React.ReactNode,
    inputMode?: 'numeric',
  ) =>
    (s: Supplier) =>
      editingId === s.id ? (
        <input
          className={styles.cellInput}
          value={edit[field]}
          inputMode={inputMode}
          onChange={setEditField(field)}
          aria-label={t(`suppliers.fields.${field}`)}
        />
      ) : (
        render(s)
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
        <div className={styles.rowActions}>
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
              <Button
                size="sm"
                onClick={() => {
                  setEditingId(s.id);
                  setEdit(toDraft(s));
                }}
              >
                {t('common.edit')}
              </Button>
              <Button variant="ghostDanger" size="sm" onClick={() => void remove(s)}>
                {t('common.delete')}
              </Button>
            </>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <div className={styles.header}>
        <h2>
          {t('suppliers.title')}
          <span className={styles.count}>{rows.length}</span>
        </h2>
        <Button variant="primary" onClick={() => setAdding((v) => !v)}>
          {adding ? t('common.cancel') : t('suppliers.add')}
        </Button>
      </div>

      {adding && (
        <div className={styles.addForm}>
          <TextField
            label="suppliers.fields.name"
            required
            autoFocus
            value={draft.name}
            onChange={setDraftField('name')}
          />
          <TextField
            label="suppliers.fields.taxId"
            inputMode="numeric"
            value={draft.taxId}
            onChange={setDraftField('taxId')}
          />
          <TextField
            label="suppliers.fields.phone"
            type="tel"
            value={draft.phone}
            onChange={setDraftField('phone')}
          />
          <TextField
            label="suppliers.fields.email"
            type="email"
            value={draft.email}
            onChange={setDraftField('email')}
          />
          <TextField
            label="suppliers.fields.address"
            value={draft.address}
            onChange={setDraftField('address')}
          />
          <div className={styles.addActions}>
            <Button variant="primary" onClick={() => void submitNew()} disabled={!draft.name.trim()}>
              {t('common.save')}
            </Button>
          </div>
        </div>
      )}

      <Table
        columns={columns}
        rows={rows}
        rowKey={(s) => s.id}
        emptyKey="suppliers.empty"
      />
    </>
  );
}
