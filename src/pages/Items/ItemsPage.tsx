import { shekel, toCatalogCode, type Item } from '@garage/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/Button';
import { CrudForm } from '../../components/CrudForm';
import { TextField } from '../../components/Field';
import { PageHeader } from '../../components/PageHeader';
import { CellInput, RowActions, Table, type Column } from '../../components/Table';
import styles from './ItemsPage.module.css';
import { blankItem, toDraft, useItems, type ItemDraft } from './useItems';


export default function ItemsPage() {
  const { t } = useTranslation();
  const { rows, shown, query, setQuery, create, update, remove } = useItems();

  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<ItemDraft>(blankItem);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [edit, setEdit] = useState<ItemDraft>(blankItem);

  /* The code is uppercase Latin and is normalised under the cursor: lowercase
     rises, Hebrew never appears. The name beside it is free text — it is the
     half a customer reads. */
  const text = (key: 'sku' | 'name') => ({
    value: draft[key],
    onChange: (e: { target: { value: string } }) =>
      setDraft((prev) => ({
        ...prev,
        [key]: key === 'sku' ? toCatalogCode(e.target.value) : e.target.value,
      })),
  });

  const num = (key: 'price' | 'stock') => ({
    value: String(draft[key]),
    type: 'number' as const,
    min: 0,
    onChange: (e: { target: { value: string } }) =>
      setDraft((prev) => ({ ...prev, [key]: Number(e.target.value) })),
  });

  const editText = (key: 'sku' | 'name') => ({
    value: edit[key],
    'aria-label': t(`items.fields.${key}`),
    onChange: (e: { target: { value: string } }) =>
      setEdit((prev) => ({
        ...prev,
        [key]: key === 'sku' ? toCatalogCode(e.target.value) : e.target.value,
      })),
  });

  const editNum = (key: 'price' | 'stock') => ({
    value: String(edit[key]),
    type: 'number' as const,
    min: 0,
    'aria-label': t(`items.fields.${key}`),
    onChange: (e: { target: { value: string } }) =>
      setEdit((prev) => ({ ...prev, [key]: Number(e.target.value) })),
  });

  const submitNew = async () => {
    if (await create(draft)) {
      setDraft(blankItem);
      setAdding(false);
    }
  };

  const columns: Column<Item>[] = [
    {
      key: 'sku',
      header: 'items.fields.sku',
      width: 150,
      sortValue: (i) => i.sku,
      cellClassName: styles.muted,
      render: (i) => (editingId === i.id ? <CellInput {...editText('sku')} /> : i.sku),
    },
    {
      key: 'name',
      header: 'items.fields.name',
      sortValue: (i) => i.name,
      render: (i) =>
        editingId === i.id ? <CellInput {...editText('name')} /> : <strong>{i.name}</strong>,
    },
    {
      key: 'price',
      header: 'items.fields.price',
      width: 130,
      sortValue: (i) => i.price,
      render: (i) => (editingId === i.id ? <CellInput {...editNum('price')} /> : shekel(i.price)),
    },
    {
      key: 'stock',
      header: 'items.fields.stock',
      width: 110,
      sortValue: (i) => i.stock,
      render: (i) =>
        editingId === i.id ? (
          <CellInput {...editNum('stock')} />
        ) : (
          /* Zero is the number worth seeing on this screen — it is the one that
             means someone has to order the part. */
          <span className={i.stock === 0 ? styles.out : styles.muted}>{i.stock}</span>
        ),
    },
    {
      key: 'actions',
      width: 170,
      render: (i) => (
        <RowActions>
          {editingId === i.id ? (
            <>
              <Button
                variant="primary"
                size="sm"
                onClick={async () => {
                  if (await update(i.id, edit)) setEditingId(null);
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
              <Button size="sm" onClick={() => { setEditingId(i.id); setEdit(toDraft(i)); }}>
                {t('common.edit')}
              </Button>
              <Button variant="ghostDanger" size="sm" onClick={() => void remove(i)}>
                {t('common.delete')}
              </Button>
            </>
          )}
        </RowActions>
      ),
    },
  ];

  const filtering = query.trim().length > 0;

  return (
    <>
      <PageHeader
        title="items.title"
        count={rows.length}
        actions={
          <Button variant="primary" onClick={() => setAdding((v) => !v)}>
            {adding ? t('common.cancel') : t('items.add')}
          </Button>
        }
      />

      <div className={styles.filters}>
        <input
          className={styles.search}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('items.searchPlaceholder')}
          aria-label={t('items.searchPlaceholder')}
        />
        {filtering && <Button onClick={() => setQuery('')}>{t('common.reset')}</Button>}
      </div>

      {adding && (
        <CrudForm
          onSubmit={() => void submitNew()}
          actions={
            <Button
              variant="primary"
              type="submit"
              disabled={!draft.sku.trim() || !draft.name.trim()}
            >
              {t('common.save')}
            </Button>
          }
        >
          <TextField
            label="items.fields.sku"
            required
            autoFocus
            hint="works.codeFormat"
            {...text('sku')}
          />
          <TextField label="items.fields.name" required {...text('name')} />
          <TextField label="items.fields.price" {...num('price')} />
          <TextField label="items.fields.stock" {...num('stock')} />
        </CrudForm>
      )}

      <Table
        columns={columns}
        rows={shown}
        rowKey={(i) => i.id}
        /* "none yet" and "none matched" are different things to be told, and
           the second one should repeat what was searched for. */
        empty={
          rows.length
            ? t('items.noMatch', { query: query.trim() })
            : t('items.empty')
        }
        footer={filtering ? t('items.showing', { shown: shown.length, total: rows.length }) : undefined}
      />
    </>
  );
}
