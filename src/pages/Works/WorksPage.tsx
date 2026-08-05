import { toCatalogCode, type WorkDef } from '@garage/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/Button';
import { CrudForm } from '../../components/CrudForm';
import { TextField } from '../../components/Field';
import { PageHeader } from '../../components/PageHeader';
import { CellInput, RowActions, Table, type Column } from '../../components/Table';
import styles from './WorksPage.module.css';
import { blankWorkDef, toDraft, useWorks, type WorkDefDraft } from './useWorks';

const shekel = (n: number) => '₪' + n.toLocaleString('he-IL');

/* The garage's catalog of works — the definitions a ticket copies from, not the
   works on any ticket. Editing a price here changes what the NEXT ticket picks
   up; tickets already written keep the price they were written at, because
   their works are their own rows. That is the whole reason the two are separate
   tables, and the hint under the header says so on screen. */
export default function WorksPage() {
  const { t } = useTranslation();
  const { rows, shown, query, setQuery, create, update, remove } = useWorks();

  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<WorkDefDraft>(blankWorkDef);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [edit, setEdit] = useState<WorkDefDraft>(blankWorkDef);

  /* The code is uppercase Latin and is normalised under the cursor: lowercase
     rises, Hebrew never appears. The name beside it is free text — it is the
     half a customer reads. */
  const text = (key: 'code' | 'name') => ({
    value: draft[key],
    onChange: (e: { target: { value: string } }) =>
      setDraft((prev) => ({
        ...prev,
        [key]: key === 'code' ? toCatalogCode(e.target.value) : e.target.value,
      })),
  });

  const num = (key: 'labor' | 'hours') => ({
    value: String(draft[key]),
    type: 'number' as const,
    min: 0,
    onChange: (e: { target: { value: string } }) =>
      setDraft((prev) => ({ ...prev, [key]: Number(e.target.value) || 0 })),
  });

  const editText = (key: 'code' | 'name') => ({
    value: edit[key],
    'aria-label': t(`works.fields.${key}`),
    onChange: (e: { target: { value: string } }) =>
      setEdit((prev) => ({
        ...prev,
        [key]: key === 'code' ? toCatalogCode(e.target.value) : e.target.value,
      })),
  });

  const editNum = (key: 'labor' | 'hours') => ({
    value: String(edit[key]),
    type: 'number' as const,
    min: 0,
    'aria-label': t(`works.fields.${key}`),
    onChange: (e: { target: { value: string } }) =>
      setEdit((prev) => ({ ...prev, [key]: Number(e.target.value) || 0 })),
  });

  const submitNew = async () => {
    if (await create(draft)) {
      setDraft(blankWorkDef);
      setAdding(false);
    }
  };

  const columns: Column<WorkDef>[] = [
    {
      key: 'code',
      header: 'works.fields.code',
      width: 140,
      sortValue: (w) => w.code,
      cellClassName: styles.muted,
      render: (w) => (editingId === w.id ? <CellInput {...editText('code')} /> : w.code),
    },
    {
      key: 'name',
      header: 'works.fields.name',
      sortValue: (w) => w.name,
      render: (w) =>
        editingId === w.id ? <CellInput {...editText('name')} /> : <strong>{w.name}</strong>,
    },
    {
      key: 'labor',
      header: 'works.fields.labor',
      width: 130,
      sortValue: (w) => w.labor,
      render: (w) => (editingId === w.id ? <CellInput {...editNum('labor')} /> : shekel(w.labor)),
    },
    {
      key: 'hours',
      header: 'works.fields.hours',
      width: 110,
      sortValue: (w) => w.hours,
      render: (w) =>
        editingId === w.id ? (
          <CellInput {...editNum('hours')} />
        ) : (
          <span className={styles.muted}>{w.hours || '—'}</span>
        ),
    },
    {
      /* Read-only here on purpose. A work's parts are edited where the quote is
         built, in the works picker on a ticket — this screen is the price list.
         Showing the count keeps it honest about what picking the work will
         pull in. */
      key: 'parts',
      header: 'works.fields.parts',
      width: 90,
      sortValue: (w) => w.items.length,
      cellClassName: styles.muted,
      render: (w) => w.items.length,
    },
    {
      key: 'actions',
      width: 170,
      render: (w) => (
        <RowActions>
          {editingId === w.id ? (
            <>
              <Button
                variant="primary"
                size="sm"
                onClick={async () => {
                  if (await update(w.id, edit)) setEditingId(null);
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
              <Button size="sm" onClick={() => { setEditingId(w.id); setEdit(toDraft(w)); }}>
                {t('common.edit')}
              </Button>
              <Button variant="ghostDanger" size="sm" onClick={() => void remove(w)}>
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
        title="works.title"
        count={rows.length}
        actions={
          <Button variant="primary" onClick={() => setAdding((v) => !v)}>
            {adding ? t('common.cancel') : t('works.add')}
          </Button>
        }
      />

      <p className={styles.hint}>{t('works.catalogHint')}</p>

      <div className={styles.filters}>
        <input
          className={styles.search}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('works.searchPlaceholder')}
          aria-label={t('works.searchPlaceholder')}
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
              disabled={!draft.code.trim() || !draft.name.trim()}
            >
              {t('common.save')}
            </Button>
          }
        >
          <TextField
            label="works.fields.code"
            required
            autoFocus
            hint="works.codeFormat"
            {...text('code')}
          />
          <TextField label="works.fields.name" required {...text('name')} />
          <TextField label="works.fields.labor" {...num('labor')} />
          <TextField label="works.fields.hours" {...num('hours')} />
        </CrudForm>
      )}

      <Table
        columns={columns}
        rows={shown}
        rowKey={(w) => w.id}
        /* "none yet" and "none matched" are different things to be told, and
           the second one should repeat what was searched for. */
        empty={rows.length ? t('works.noMatch', { query: query.trim() }) : t('works.empty')}
        footer={filtering ? t('works.showing', { shown: shown.length, total: rows.length }) : undefined}
      />
    </>
  );
}
