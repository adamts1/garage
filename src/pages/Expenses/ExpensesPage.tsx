import { money } from '@garage/shared';
import type { SupplierExpense } from '@garage/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/Button';
import { CrudForm } from '../../components/CrudForm';
import { EmptyState } from '../../components/EmptyState';
import { CheckboxField, SelectField, TextField } from '../../components/Field';
import { KpiCard, KpiRow } from '../../components/KpiCard';
import { PageHeader } from '../../components/PageHeader';
import { Pill } from '../../components/Pill';
import { RowActions, Table, type Column } from '../../components/Table';
import { IconBox, IconCard, IconDoc } from '../../icons';
import styles from './ExpensesPage.module.css';
import { printExpense } from './printExpense';
import { blankExpense, previewTotals, useExpenses, type ExpenseDraft } from './useExpenses';

const fmt = (iso: string) => new Date(iso).toLocaleDateString('he-IL');

export default function ExpensesPage() {
  const { t } = useTranslation();
  const { rows, suppliers, busy, totals, create, retrySync, togglePaid, remove } = useExpenses();

  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<ExpenseDraft>(blankExpense);

  const field = (key: keyof ExpenseDraft) => ({
    value: String(draft[key]),
    onChange: (e: { target: { value: string } }) =>
      setDraft((prev) => ({ ...prev, [key]: e.target.value })),
  });

  const preview = previewTotals(draft.subtotal, draft.vatRate);
  const canSave = Boolean(draft.supplierId) && Number(draft.subtotal) > 0;

  const submit = async () => {
    if (await create(draft)) {
      // The date is kept: entering a stack of one day's invoices is the normal
      // way this screen is used.
      setDraft({ ...blankExpense(), date: draft.date });
      setAdding(false);
    }
  };

  const syncPill = (e: SupplierExpense) => {
    if (e.syncStatus === 'synced') {
      return (
        <Pill tone="ok" title={`iCount #${e.providerExpenseId ?? ''}`}>
          {t('expenses.sync.synced')}
        </Pill>
      );
    }
    if (e.syncStatus === 'error') {
      return (
        <Pill
          tone="danger"
          title={e.syncError ?? t('expenses.sync.retryHint')}
          onClick={() => void retrySync(e.id)}
        >
          {t('expenses.sync.errorRetry')}
        </Pill>
      );
    }
    return (
      <Pill tone="warn" title={t('expenses.sync.pendingHint')} onClick={() => void retrySync(e.id)}>
        {t('expenses.sync.pending')}
      </Pill>
    );
  };

  const columns: Column<SupplierExpense>[] = [
    {
      key: 'date',
      header: 'expenses.fields.date',
      width: 110,
      sortValue: (e) => e.date,
      cellClassName: styles.muted,
      render: (e) => fmt(e.date),
    },
    {
      key: 'supplier',
      header: 'expenses.fields.supplier',
      sortValue: (e) => e.supplierName ?? '',
      render: (e) => <strong>{e.supplierName ?? '-'}</strong>,
    },
    {
      key: 'description',
      header: 'expenses.fields.description',
      render: (e) => e.description || '-',
    },
    {
      key: 'reference',
      header: 'expenses.fields.reference',
      cellClassName: styles.muted,
      render: (e) => e.reference || '-',
    },
    {
      key: 'subtotal',
      header: 'expenses.fields.subtotal',
      sortValue: (e) => e.subtotal,
      render: (e) => money(e.subtotal),
    },
    {
      key: 'vat',
      header: 'expenses.fields.vat',
      cellClassName: styles.muted,
      render: (e) => money(e.vat),
    },
    {
      key: 'total',
      header: 'expenses.fields.total',
      sortValue: (e) => e.total,
      render: (e) => <strong>{money(e.total)}</strong>,
    },
    {
      key: 'paid',
      header: 'expenses.fields.paid',
      sortValue: (e) => (e.paid ? 0 : 1),
      render: (e) => (
        <Pill
          tone={e.paid ? 'ok' : 'neutral'}
          title={t('expenses.togglePaid')}
          onClick={() => void togglePaid(e)}
        >
          {t(e.paid ? 'expenses.paid' : 'expenses.unpaid')}
        </Pill>
      ),
    },
    {
      key: 'sync',
      header: 'expenses.fields.sync',
      sortValue: (e) => e.syncStatus,
      render: syncPill,
    },
    {
      key: 'actions',
      width: 150,
      render: (e) => (
        <RowActions>
          <Button size="sm" onClick={() => printExpense(e)}>{t('expenses.print')}</Button>
          <Button variant="ghostDanger" size="sm" onClick={() => void remove(e)}>
            {t('common.delete')}
          </Button>
        </RowActions>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="expenses.title"
        count={rows.length}
        actions={
          <Button
            variant="primary"
            onClick={() => setAdding((v) => !v)}
            disabled={suppliers.length === 0}
          >
            {adding ? t('common.cancel') : t('expenses.add')}
          </Button>
        }
      />

      {/* An expense belongs to a supplier, so with none on file there is
          nothing to record against — say that rather than disabling a button
          with no explanation. */}
      {suppliers.length === 0 && (
        <EmptyState title="expenses.noSuppliersTitle" body="expenses.noSuppliersBody" icon={<IconBox />} />
      )}

      <KpiRow>
        <KpiCard label="expenses.kpi.total" value={money(totals.total)} tone="navy" icon={<IconCard />} />
        <KpiCard label="expenses.kpi.unpaid" value={money(totals.unpaid)} tone="warn" icon={<IconCard />} />
        <KpiCard label="expenses.kpi.unsynced" value={String(totals.unsynced)} tone="danger" icon={<IconDoc />} />
      </KpiRow>

      {adding && (
        <CrudForm
          onSubmit={() => void submit()}
          actions={
            <>
              <span className={styles.preview}>
                {t('expenses.preview', {
                  vat: money(preview.vat),
                  total: money(preview.total),
                })}
              </span>
              <Button variant="primary" type="submit" disabled={busy || !canSave}>
                {busy ? t('expenses.saving') : t('expenses.saveAndSync')}
              </Button>
            </>
          }
        >
          <SelectField label="expenses.fields.supplier" required autoFocus {...field('supplierId')}>
            <option value="">{t('expenses.pickSupplier')}</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </SelectField>
          <TextField label="expenses.fields.date" type="date" {...field('date')} />
          <TextField label="expenses.fields.description" {...field('description')} />
          <TextField label="expenses.fields.category" {...field('category')} />
          <TextField label="expenses.fields.reference" {...field('reference')} />
          <TextField
            label="expenses.fields.subtotal"
            required
            inputMode="decimal"
            {...field('subtotal')}
          />
          <SelectField label="expenses.fields.vatRate" {...field('vatRate')}>
            <option value="0.18">{t('expenses.vat18')}</option>
            <option value="0">{t('expenses.vatNone')}</option>
          </SelectField>
          {/* When the supplier is owed. Blank is on receipt, which is the common
              case — so it is left blank rather than pre-filled with today, which
              would be an answer nobody gave. This is what ages the bill in the
              obligo and aging reports. */}
          <TextField label="expenses.fields.dueDate" hint="expenses.dueDateHint" type="date" {...field('dueDate')} />
          <CheckboxField
            label="expenses.fields.paid"
            checked={draft.paid}
            onChange={(e) => setDraft((prev) => ({ ...prev, paid: e.target.checked }))}
          />
          {/* Only once it has been paid, and only because a cheque is the one
              payment that lands on a day of its own choosing. Cash and transfers
              leave the account when they are made; a post-dated cheque is a
              commitment with a date on it, and that date is the whole subject of
              the obligo report. */}
          {draft.paid && (
            <>
              <TextField label="expenses.fields.chequeNumber" {...field('chequeNumber')} />
              <TextField label="expenses.fields.chequeDate" hint="expenses.chequeDateHint" type="date" {...field('chequeDate')} />
            </>
          )}
        </CrudForm>
      )}

      <Table columns={columns} rows={rows} rowKey={(e) => e.id} emptyKey="expenses.empty" />
    </>
  );
}
