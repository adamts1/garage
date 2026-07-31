import { suggestInitials, type Worker } from '@garage/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/Button';
import { CrudForm } from '../../components/CrudForm';
import { SelectField, TextField } from '../../components/Field';
import { PageHeader } from '../../components/PageHeader';
import { CellInput, CellSelect, RowActions, Table, type Column } from '../../components/Table';
import styles from './WorkersPage.module.css';
import { blankWorker, toDraft, useWorkers, WORKER_COLORS, type WorkerDraft } from './useWorkers';

const Avatar = ({ color, initials }: { color: string; initials: string }) => (
  <span className={styles.avatar} style={{ background: color }}>
    {initials || '—'}
  </span>
);

export default function WorkersPage() {
  const { t } = useTranslation();
  const { rows, activeCount, create, update, toggleActive, remove } = useWorkers();

  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<WorkerDraft>(blankWorker);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [edit, setEdit] = useState<WorkerDraft>(blankWorker);

  /* Only the fields that have a label under workers.fields. `position` and
     `active` are part of the draft but are not typed by hand — position is
     assigned on create, active is the retire button — and naming one here would
     build a translation key that does not exist. */
  type LabelledField = 'code' | 'name' | 'initials' | 'color';

  const draftField = (key: LabelledField) => ({
    value: draft[key],
    onChange: (e: { target: { value: string } }) =>
      setDraft((prev) => ({ ...prev, [key]: e.target.value })),
  });

  const editField = (key: LabelledField) => ({
    value: edit[key],
    'aria-label': t(`workers.fields.${key}`),
    onChange: (e: { target: { value: string } }) =>
      setEdit((prev) => ({ ...prev, [key]: e.target.value })),
  });

  const submitNew = async () => {
    if (await create(draft)) {
      setDraft(blankWorker);
      setAdding(false);
    }
  };

  const columns: Column<Worker>[] = [
    {
      key: 'name',
      header: 'workers.fields.name',
      sortValue: (w) => w.name,
      render: (w) =>
        editingId === w.id ? (
          <CellInput {...editField('name')} />
        ) : (
          <div className={styles.person}>
            <Avatar color={w.color} initials={w.initials} />
            <strong>{w.name}</strong>
          </div>
        ),
    },
    {
      key: 'code',
      header: 'workers.fields.code',
      width: 130,
      sortValue: (w) => w.code,
      cellClassName: styles.code,
      render: (w) => (editingId === w.id ? <CellInput {...editField('code')} /> : w.code),
    },
    {
      key: 'initials',
      header: 'workers.fields.initials',
      width: 120,
      render: (w) => (editingId === w.id ? <CellInput {...editField('initials')} /> : w.initials),
    },
    {
      key: 'color',
      header: 'workers.fields.color',
      width: 130,
      render: (w) =>
        editingId === w.id ? (
          <CellSelect {...editField('color')}>
            {WORKER_COLORS.map((c) => <option key={c} value={c}>{c}</option>)}
          </CellSelect>
        ) : (
          <span className={styles.swatch} style={{ background: w.color }} aria-hidden="true" />
        ),
    },
    {
      key: 'active',
      header: 'workers.fields.status',
      width: 110,
      sortValue: (w) => (w.active ? 0 : 1),
      render: (w) => (
        <span className={w.active ? styles.active : styles.retired}>
          {t(w.active ? 'workers.active' : 'workers.inactive')}
        </span>
      ),
    },
    {
      key: 'actions',
      width: 230,
      render: (w) => (
        <RowActions>
          {editingId === w.id ? (
            <>
              <Button
                variant="primary"
                size="sm"
                disabled={!edit.name.trim()}
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
              <Button size="sm" onClick={() => void toggleActive(w)}>
                {t(w.active ? 'workers.retire' : 'workers.reactivate')}
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

  return (
    <>
      <PageHeader
        title="workers.title"
        count={activeCount}
        actions={
          <Button variant="primary" onClick={() => setAdding((v) => !v)}>
            {adding ? t('common.cancel') : t('workers.add')}
          </Button>
        }
      />

      {adding && (
        <CrudForm
          onSubmit={() => void submitNew()}
          actions={
            <>
              {/* Live preview of the chip that will appear on the board. The
                  colour and the initials are otherwise abstract choices. */}
              <Avatar
                color={draft.color}
                initials={draft.initials.trim() || suggestInitials(draft.name)}
              />
              <Button
                variant="primary"
                type="submit"
                disabled={!draft.code.trim() || !draft.name.trim()}
              >
                {t('common.save')}
              </Button>
            </>
          }
        >
          <TextField
            label="workers.fields.code"
            hint="workers.codeHint"
            required
            autoFocus
            {...draftField('code')}
          />
          <TextField label="workers.fields.name" required {...draftField('name')} />
          <TextField
            label="workers.fields.initials"
            /* Left blank, the name supplies them — so the placeholder shows what
               would be saved rather than repeating the label. */
            placeholder={draft.name ? suggestInitials(draft.name) : undefined}
            {...draftField('initials')}
          />
          <SelectField label="workers.fields.color" {...draftField('color')}>
            {WORKER_COLORS.map((c) => <option key={c} value={c}>{c}</option>)}
          </SelectField>
        </CrudForm>
      )}

      <Table columns={columns} rows={rows} rowKey={(w) => w.id} emptyKey="workers.empty" />
    </>
  );
}
