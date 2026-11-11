/* The new-expense form, as a drawer beside the list (2026-11-11 redesign).

   Rendered by the page rather than opened through the modal registry: saving
   can fail, and a registry modal hands its answer back by closing — so a failed
   save would throw away everything typed. Here the drawer stays up until the
   save has gone through.

   The part picker it opens does go through the registry, so this one steps
   down (isTop false) while the picker is up, and Escape closes only the picker. */

import { money, type PartDef, type Supplier } from '@garage/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/Button';
import { CheckboxField, SelectField, TextField } from '../../components/Field';
import Modal from '../../components/Modal/Modal';
import { usePickPart } from '../../features/works/usePickers';
import { IconBox, IconTrash } from '../../icons';
import { useAppSelector } from '../../store';
import styles from './ExpenseDrawer.module.css';
import {
  blankExpense, blankLine, draftSubtotal, previewTotals, readyLines,
  type DraftLine, type ExpenseDraft,
} from './useExpenses';

/** What a garage buys, offered before anything has been typed. Categories
 *  already used are added to these; iCount matches a category by name and
 *  creates it when new, so any of them is a valid answer. */
export const DEFAULT_CATEGORIES = [
  'חלפים', 'שמנים ונוזלים', 'צמיגים', 'כלים וציוד', 'שכירות', 'חשמל ומים',
  'תקשורת', 'דלק', 'אחזקה', 'כללי',
];

export interface ExpenseDrawerProps {
  suppliers: Supplier[];
  /** Categories already on file, offered beside the defaults. */
  usedCategories: string[];
  busy: boolean;
  /** Resolves true once saved — only then does the drawer close. */
  onSave: (draft: ExpenseDraft) => Promise<boolean>;
  onClose: () => void;
  /** The date the last expense was entered with — a stack of one day's
   *  invoices is the normal way this screen is used. */
  initialDate?: string;
}

export default function ExpenseDrawer({
  suppliers, usedCategories, busy, onSave, onClose, initialDate,
}: ExpenseDrawerProps) {
  const { t } = useTranslation();
  const pickPart = usePickPart();
  const pickerUp = useAppSelector((s) => s.modal.stack.length > 0);
  const [draft, setDraft] = useState<ExpenseDraft>(() => ({
    ...blankExpense(), ...(initialDate ? { date: initialDate } : {}),
  }));

  const set = (key: Exclude<keyof ExpenseDraft, 'lines' | 'paid'>) => ({
    value: draft[key],
    onChange: (e: { target: { value: string } }) => setDraft((prev) => ({ ...prev, [key]: e.target.value })),
  });

  const categories = [...new Set([...DEFAULT_CATEGORIES, ...usedCategories.filter(Boolean)])];

  const subtotal = draftSubtotal(draft.lines);
  const totals = previewTotals(String(subtotal), draft.vatRate);
  const vatPercent = Math.round((Number(draft.vatRate) || 0) * 100);
  const canSave = Boolean(draft.supplierId) && Boolean(draft.date) && Boolean(draft.category)
    && !readyLines(draft.lines).incomplete && subtotal > 0;

  const patchLine = (uid: string, over: Partial<DraftLine>) =>
    setDraft((prev) => ({ ...prev, lines: prev.lines.map((l) => (l.uid === uid ? { ...l, ...over } : l)) }));
  const addLine = () => setDraft((prev) => ({ ...prev, lines: [...prev.lines, blankLine()] }));
  const removeLine = (uid: string) =>
    setDraft((prev) => ({ ...prev, lines: prev.lines.filter((l) => l.uid !== uid) }));

  /* Parts off the garage's own catalogue, by name. The price is left for the
     supplier's invoice to say: the catalogue holds what the garage charges,
     not what it paid. */
  const addFromCatalogue = async () => {
    const parts: PartDef[] | null = await pickPart();
    if (!parts?.length) return;
    setDraft((prev) => {
      const picked = parts.map((p) => ({ ...blankLine(), desc: p.name }));
      const empty = prev.lines.find((l) => !l.desc.trim() && !l.unitPrice.trim());
      if (!empty) return { ...prev, lines: [...prev.lines, ...picked] };
      const [first, ...rest] = picked;
      return { ...prev, lines: [...prev.lines.map((l) => (l === empty ? first : l)), ...rest] };
    });
  };

  const save = async () => {
    if (!canSave || busy) return;
    if (await onSave(draft)) onClose();
  };

  return (
    <Modal
      title="expenses.drawer.title"
      variant="drawer"
      isTop={!pickerUp}
      onClose={onClose}
      actions={
        <>
          <Button variant="primary" className={styles.save} disabled={busy || !canSave} onClick={() => void save()}>
            {busy ? t('expenses.saving') : t('expenses.drawer.save')}
          </Button>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
        </>
      }
    >
      <form className={styles.form} onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <section className={styles.section}>
          <h4 className={styles.sectionTitle}>{t('expenses.drawer.details')}</h4>
          <SelectField label="expenses.fields.supplier" required data-autofocus {...set('supplierId')}>
            <option value="">{t('expenses.pickSupplier')}</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </SelectField>
          <div className={styles.pair}>
            <TextField label="expenses.fields.date" required type="date" {...set('date')} />
            <TextField label="expenses.drawer.reference" {...set('reference')} />
          </div>
          <div className={styles.pair}>
            <SelectField label="expenses.fields.category" required {...set('category')}>
              <option value="">{t('expenses.drawer.pickCategory')}</option>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </SelectField>
            <TextField label="expenses.fields.description" {...set('description')} />
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <h4 className={styles.sectionTitle}>{t('expenses.lines.title')}</h4>
            <Button size="sm" onClick={() => void addFromCatalogue()}>
              <IconBox /> {t('expenses.lines.fromCatalogue')}
            </Button>
          </div>
          <div className={`${styles.line} ${styles.lineLabels}`} aria-hidden="true">
            <span>{t('expenses.lines.desc')}</span>
            <span>{t('expenses.lines.qty')}</span>
            <span>{t('expenses.lines.unitPrice')}</span>
            <span>{t('expenses.lines.total')}</span>
            <span />
          </div>
          {draft.lines.map((l) => (
            <div className={styles.line} key={l.uid}>
              <input
                
                value={l.desc}
                placeholder={t('expenses.lines.descPlaceholder')}
                aria-label={t('expenses.lines.desc')}
                onChange={(e) => patchLine(l.uid, { desc: e.target.value })}
              />
              <input
                inputMode="decimal"
                aria-label={t('expenses.lines.qty')}
                value={l.qty}
                onChange={(e) => patchLine(l.uid, { qty: e.target.value })}
              />
              <input
                inputMode="decimal"
                aria-label={t('expenses.lines.unitPrice')}
                placeholder="₪"
                value={l.unitPrice}
                onChange={(e) => patchLine(l.uid, { unitPrice: e.target.value })}
              />
              <span className={styles.lineTotal}>
                {money((Number(l.qty) || 0) * (Number(l.unitPrice) || 0))}
              </span>
              <Button
                variant="ghostDanger" size="sm"
                aria-label={t('expenses.lines.remove')}
                disabled={draft.lines.length === 1}
                onClick={() => removeLine(l.uid)}
              >
                <IconTrash />
              </Button>
            </div>
          ))}
          <button type="button" className={styles.addRow} onClick={addLine}>
            ＋ {t('expenses.lines.add')}
          </button>
        </section>

        <section className={styles.section}>
          <h4 className={styles.sectionTitle}>{t('expenses.drawer.payment')}</h4>
          <div className={styles.pair}>
            <SelectField label="expenses.drawer.vat" required {...set('vatRate')}>
              <option value="0.18">18%</option>
              <option value="0">{t('expenses.vatNone')}</option>
            </SelectField>
            {/* Blank is on receipt, the common case — left blank rather than
                pre-filled, which would be an answer nobody gave. This is what
                ages the bill in the obligo and aging reports. */}
            <TextField label="expenses.fields.dueDate" hint="expenses.dueDateHint" type="date" {...set('dueDate')} />
          </div>
          <CheckboxField
            label="expenses.drawer.paid"
            checked={draft.paid}
            onChange={(e) => setDraft((prev) => ({ ...prev, paid: e.target.checked }))}
          />
          {/* A cheque is the one payment that lands on a day of its own
              choosing — that date is the whole subject of the obligo report. */}
          {draft.paid && (
            <div className={styles.pair}>
              <TextField label="expenses.fields.chequeNumber" {...set('chequeNumber')} />
              <TextField label="expenses.fields.chequeDate" hint="expenses.chequeDateHint" type="date" {...set('chequeDate')} />
            </div>
          )}
        </section>

        <div className={styles.summary}>
          <div><span>{t('expenses.fields.subtotal')}</span><span>{money(totals.subtotal)}</span></div>
          <div>
            <span>{vatPercent ? t('expenses.drawer.vatLine', { percent: vatPercent }) : t('expenses.vatNone')}</span>
            <span>{money(totals.vat)}</span>
          </div>
          <div className={styles.grand}><span>{t('expenses.drawer.total')}</span><span>{money(totals.total)}</span></div>
        </div>
        {/* Enter in a field saves, as it did in the old inline form. */}
        <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
      </form>
    </Modal>
  );
}
