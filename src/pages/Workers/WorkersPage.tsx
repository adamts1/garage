import {
  getCurrentUserId, isGarageAdmin, suggestInitials, type GarageRole, type Staff,
} from '@garage/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate } from 'react-router-dom';
import { Button } from '../../components/Button';
import { CrudForm } from '../../components/CrudForm';
import { SelectField, TextField } from '../../components/Field';
import { PageHeader } from '../../components/PageHeader';
import { CellInput, CellSelect, RowActions, Table, type Column } from '../../components/Table';
import styles from './WorkersPage.module.css';
import {
  blankStaff, toDraft, useWorkers, WORKER_COLORS,
  type StaffDraft, type WorkerEditDraft,
} from './useWorkers';

const Avatar = ({ color, initials }: { color: string; initials: string }) => (
  <span className={styles.avatar} style={{ background: color }}>
    {initials || '—'}
  </span>
);

/* Squares you can point at, instead of #3e5c76. The colour is the chip on the
   board — an entirely visual decision, and a hex code is the one way to make it
   look like a setting nobody should touch. */
const ColorPicker = ({ value, onChange, label }: {
  value: string;
  onChange: (c: string) => void;
  label: string;
}) => (
  <div className={styles.colors} role="radiogroup" aria-label={label}>
    {WORKER_COLORS.map((c) => (
      <button
        key={c}
        type="button"
        role="radio"
        aria-checked={c === value}
        aria-label={c}
        className={`${styles.colorDot}${c === value ? ` ${styles.colorOn}` : ''}`}
        style={{ background: c }}
        onClick={() => onChange(c)}
      />
    ))}
  </div>
);

/* The garage's people — the same people who sign in. There is no separate
   notion of a mechanic any more: adding somebody here creates their account,
   their membership and their board chip together.

   Admin only, and not merely by hiding the button: the whole page is theirs. It
   shows every colleague's email and role, and it is the one place a role can be
   changed. */
export default function WorkersPage() {
  const { t } = useTranslation();
  const { rows, activeCount, busy, create, update, toggleActive, setRole } = useWorkers();

  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<StaffDraft>(blankStaff);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [edit, setEdit] = useState<WorkerEditDraft>(toDraft({} as Staff));

  /* Which row is the person reading the screen. Their own role is shown but not
     offered: see the role column below. */
  const meId = getCurrentUserId();

  /* A hidden nav item is still a typeable address, and this page reads other
     people's email addresses. The redirect is the boundary; the missing link is
     the courtesy. */
  if (!isGarageAdmin()) return <Navigate to="/" replace />;

  const draftField = (key: 'name' | 'email' | 'password' | 'initials') => ({
    value: draft[key],
    onChange: (e: { target: { value: string } }) =>
      setDraft((prev) => ({ ...prev, [key]: e.target.value })),
  });

  const editField = (key: keyof WorkerEditDraft) => ({
    value: edit[key],
    'aria-label': t(`workers.fields.${key}`),
    onChange: (e: { target: { value: string } }) =>
      setEdit((prev) => ({ ...prev, [key]: e.target.value })),
  });

  const submitNew = async () => {
    if (await create(draft)) {
      setDraft(blankStaff);
      setAdding(false);
    }
  };

  const columns: Column<Staff>[] = [
    {
      key: 'name',
      header: 'workers.fields.name',
      sortValue: (w) => w.name,
      render: (w) =>
        editingId === w.id ? (
          <div className={styles.editRow}>
            <CellInput {...editField('name')} />
            <CellInput className={styles.initialsCell} {...editField('initials')} />
          </div>
        ) : (
          <div className={styles.person}>
            <Avatar color={w.color} initials={w.initials} />
            <span className={w.active ? undefined : styles.retired}>{w.name}</span>
          </div>
        ),
    },
    {
      key: 'email',
      header: 'workers.fields.email',
      sortValue: (w) => w.email ?? '',
      cellClassName: styles.muted,
      /* Not editable. Changing an address means changing a login, which belongs
         to the auth system rather than to a table this screen writes. */
      render: (w) => w.email ?? t('workers.noAccount'),
    },
    {
      key: 'role',
      header: 'workers.fields.role',
      width: 150,
      sortValue: (w) => w.role ?? '',
      /* Changed here, but written by the function — which refuses to remove the
         garage's last admin, because nothing in the app could appoint another.

         Your own row is text, not a menu. The only self-change an admin could
         make is a demotion, and that is a door that locks behind them: the
         moment they become a member this page redirects, so they cannot take
         the role back. Someone else does it, or nobody does. */
      render: (w) =>
        !w.userId || !w.role ? (
          <span className={styles.muted}>{t('common.none')}</span>
        ) : w.userId === meId ? (
          <span className={styles.selfRole} title={t('workers.roleSelfLocked')}>
            {t(`workers.roles.${w.role}`)}
            <span className={styles.selfTag}>{t('workers.you')}</span>
          </span>
        ) : (
          <CellSelect
            value={w.role}
            disabled={busy}
            aria-label={t('workers.fields.role')}
            onChange={(e) => void setRole(w, e.target.value as GarageRole)}
          >
            <option value="member">{t('workers.roles.member')}</option>
            <option value="admin">{t('workers.roles.admin')}</option>
          </CellSelect>
        ),
    },
    {
      key: 'color',
      header: 'workers.fields.color',
      width: 190,
      render: (w) =>
        editingId === w.id ? (
          <ColorPicker
            value={edit.color}
            label={t('workers.fields.color')}
            onChange={(color) => setEdit((prev) => ({ ...prev, color }))}
          />
        ) : (
          <span className={styles.swatch} style={{ background: w.color }} aria-hidden="true" />
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
                onClick={async () => { if (await update(w.id, edit)) setEditingId(null); }}
              >
                {t('common.save')}
              </Button>
              <Button size="sm" onClick={() => setEditingId(null)}>{t('common.cancel')}</Button>
            </>
          ) : (
            <>
              <Button size="sm" onClick={() => { setEditingId(w.id); setEdit(toDraft(w)); }}>
                {t('common.edit')}
              </Button>
              {/* Retiring is the only way out, and it is reversible: it takes
                  the person off the board AND out of the garage, while every
                  ticket they closed keeps their name. */}
              <Button size="sm" onClick={() => void toggleActive(w)}>
                {t(w.active ? 'workers.retire' : 'workers.reactivate')}
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

      <p className={styles.hint}>{t('workers.hint')}</p>

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
                disabled={busy || !draft.name.trim() || !draft.email.trim() || draft.password.length < 8}
              >
                {t('common.save')}
              </Button>
            </>
          }
        >
          <TextField label="workers.fields.name" required autoFocus {...draftField('name')} />
          <TextField label="workers.fields.email" type="email" required {...draftField('email')} />
          {/* Handed over in person, exactly as the onboarding script does it —
              there is no inbox in this flow. */}
          <TextField
            label="workers.fields.password"
            type="password"
            required
            hint="workers.passwordHint"
            {...draftField('password')}
          />
          <SelectField
            label="workers.fields.role"
            value={draft.role}
            onChange={(e) => setDraft((prev) => ({ ...prev, role: e.target.value as GarageRole }))}
          >
            <option value="member">{t('workers.roles.member')}</option>
            <option value="admin">{t('workers.roles.admin')}</option>
          </SelectField>
          <TextField label="workers.fields.initials" {...draftField('initials')} />
          <div className={styles.colorField}>
            <span className={styles.colorLabel}>{t('workers.fields.color')}</span>
            <ColorPicker
              value={draft.color}
              label={t('workers.fields.color')}
              onChange={(color) => setDraft((prev) => ({ ...prev, color }))}
            />
          </div>
        </CrudForm>
      )}

      <Table columns={columns} rows={rows} rowKey={(w) => w.id} emptyKey="workers.empty" />
    </>
  );
}
