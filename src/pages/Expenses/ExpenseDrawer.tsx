/* The expense form, as a drawer beside the list (2026-11-11 redesign) — for a
   new expense, and for one opened from the list to see or change it.

   Rendered by the page rather than opened through the modal registry: saving
   can fail, and a registry modal hands its answer back by closing — so a failed
   save would throw away everything typed. Here the drawer stays up until the
   save has gone through.

   The part picker it opens does go through the registry, so this one steps
   down (isTop false) while the picker is up, and Escape closes only the picker.

   THE DOCUMENT (2026-11-16)

   An expense carries the supplier's document it was entered from — photos or a
   PDF. A new expense starts with the choice: upload the invoice, or type it.
   Uploading has the model read it (extract-invoice) and fills the form; what
   failed a check is marked amber and the lines are compared with the
   document's own totals, as on the phone (scanChecks in @garage/shared).
   Typing can still attach the invoice, unread. With a document the drawer
   widens: the form on the reading side, the document beside it.

   A new expense with a document is saved through save_scanned_expense — one
   transaction that can also create a supplier not on file yet, refuses a
   duplicate invoice number unless confirmed, and links the document. Without
   one, it is saved as it always was.

   An expense opened from the list shows its document, or offers to attach one
   if it has none. Its fields can be changed; the document, once attached,
   cannot be swapped (attach_expense_document). */

import {
  applyDocumentDiscount, DuplicateInvoiceError, draftFromExtraction, attachExpenseDocument,
  expenseDocumentFiles, money, saveScannedExpense, scanChecks, VAT,
  type DocumentFileLink, type ExtractResponse, type PartDef, type ScanDraft, type Supplier,
  type SupplierExpense,
} from '@garage/shared';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/Button';
import { CheckboxField, SelectField, TextField } from '../../components/Field';
import Modal from '../../components/Modal/Modal';
import { usePickPart } from '../../features/works/usePickers';
import { IconBox, IconTrash } from '../../icons';
import { showError, showErrorKey, showSuccess, useAppDispatch, useAppSelector, useBusyRun, useConfirm } from '../../store';
import { DocumentPane, DropZone } from './DocumentPane';
import styles from './ExpenseDrawer.module.css';
import { useExpenseDocument, type DocError } from './useExpenseDocument';
import {
  blankExpense, blankLine, draftSubtotal, expenseToDraft, lineQty, previewTotals, readyLines,
  type DraftLine, type ExpenseDraft,
} from './useExpenses';

/** What a garage buys, offered before anything has been typed. Categories
 *  already used are added to these; iCount matches a category by name and
 *  creates it when new, so any of them is a valid answer. */
export const DEFAULT_CATEGORIES = [
  'חלפים', 'שמנים ונוזלים', 'צמיגים', 'כלים וציוד', 'שכירות', 'חשמל ומים',
  'תקשורת', 'דלק', 'אחזקה', 'כללי',
];

/** The supplier select's "a supplier not on file yet" option. */
const NEW_SUPPLIER = '__new__';

type LineFlag = 'desc' | 'qty' | 'unitPrice';
type Mode = 'upload' | 'manual';

/** What a reading left behind for the checks: the document's own figures and
 *  how its VAT was read. Null until the document has been read. */
interface ReadState {
  response: ExtractResponse;
  invoice: ScanDraft['invoice'];
  converted: ScanDraft['converted'];
  documentDiscount: ScanDraft['documentDiscount'];
  vatBasis: ScanDraft['vatBasis'];
}

export interface ExpenseDrawerProps {
  suppliers: Supplier[];
  /** Categories already on file, offered beside the defaults. */
  usedCategories: string[];
  busy: boolean;
  /** Resolves true once saved — only then does the drawer close. */
  onSave: (draft: ExpenseDraft) => Promise<boolean>;
  /** Saved around onSave/onUpdate (with a document) — the list reloads. */
  onSavedWithDocument: () => void;
  onClose: () => void;
  /** The date the last expense was entered with — a stack of one day's
   *  invoices is the normal way this screen is used. */
  initialDate?: string;
  /** Opened from the list: this expense, to see and change. */
  expense?: SupplierExpense;
  onUpdate?: (id: string, draft: ExpenseDraft) => Promise<boolean>;
  /** Resolves true once deleted (after its own confirmation). */
  onDelete?: (e: SupplierExpense) => Promise<boolean>;
  onPrint?: (e: SupplierExpense) => void;
}

export default function ExpenseDrawer({
  suppliers, usedCategories, busy, onSave, onSavedWithDocument, onClose, initialDate,
  expense, onUpdate, onDelete, onPrint,
}: ExpenseDrawerProps) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const confirm = useConfirm();
  const run = useBusyRun();
  const pickPart = usePickPart();
  const pickerUp = useAppSelector((s) => s.modal.stack.length > 0);
  const doc = useExpenseDocument();
  const editing = expense != null;
  const [mode, setMode] = useState<Mode>('upload');
  const [draft, setDraft] = useState<ExpenseDraft>(() => (expense
    ? expenseToDraft(expense)
    : { ...blankExpense(), ...(initialDate ? { date: initialDate } : {}) }));
  const [newSupplier, setNewSupplier] = useState({ name: '', taxId: '' });
  const [matchedBy, setMatchedBy] = useState<'tax_id' | 'name' | null>(null);
  const [read, setRead] = useState<ReadState | null>(null);
  const [flags, setFlags] = useState<Record<string, LineFlag[]>>({});
  const [acceptMismatch, setAcceptMismatch] = useState(false);
  const [saving, setSaving] = useState(false);
  /** The document already on an expense opened from the list. */
  const [onFile, setOnFile] = useState<DocumentFileLink[] | null>(null);

  useEffect(() => {
    if (!expense?.scanId) return;
    let live = true;
    expenseDocumentFiles(expense.scanId)
      .then((f) => { if (live) setOnFile(f); })
      .catch((e) => { if (live) dispatch(showError(e)); });
    return () => { live = false; };
  }, [expense?.scanId, dispatch]);

  const hasNewDoc = doc.files.length > 0;
  const wide = editing || hasNewDoc;

  const set = (key: Exclude<keyof ExpenseDraft, 'lines' | 'paid'>) => ({
    value: draft[key],
    onChange: (e: { target: { value: string } }) => {
      setDraft((prev) => ({ ...prev, [key]: e.target.value }));
      if (key === 'supplierId') setMatchedBy(null);
    },
  });

  const categories = [...new Set([...DEFAULT_CATEGORIES, ...usedCategories.filter(Boolean)])];

  const sayDocError = (err: DocError | null) => {
    if (err) dispatch(showErrorKey(`expenses.doc.error.${err}`));
  };

  /** Fill the form from what the model read. What the person already chose
   *  that the document does not say — category, description, payment — stays. */
  const apply = (r: ExtractResponse) => {
    const sd = draftFromExtraction(r.extraction);
    const lines: DraftLine[] = sd.lines.length
      ? sd.lines.map((l) => ({ ...blankLine(), desc: l.desc, qty: l.qty, unitPrice: l.unitPrice }))
      : [blankLine()];
    const lineFlags: Record<string, LineFlag[]> = {};
    lines.forEach((l, i) => { if (sd.lines[i]?.flags.length) lineFlags[l.uid] = sd.lines[i].flags; });
    setDraft((prev) => ({
      ...prev,
      supplierId: r.supplier?.id ?? (sd.supplierName || sd.supplierTaxId ? NEW_SUPPLIER : prev.supplierId),
      date: sd.date || prev.date,
      reference: sd.reference || prev.reference,
      lines,
      vatRate: String(sd.vatRate),
    }));
    setNewSupplier({ name: sd.supplierName, taxId: sd.supplierTaxId });
    setMatchedBy(r.supplier?.by ?? null);
    setFlags(lineFlags);
    setAcceptMismatch(false);
    setRead({
      response: r, invoice: sd.invoice, converted: sd.converted,
      documentDiscount: sd.documentDiscount, vatBasis: sd.vatBasis,
    });
  };

  const readDocument = async () => {
    try {
      apply(await doc.read());
    } catch (e) {
      dispatch(showError(e));
    }
  };

  /** Files for the document. In "upload the invoice" mode they are read
   *  straight away; typed or opened from the list, they are only attached. */
  const addFiles = async (files: File[]) => {
    sayDocError(await doc.add(files));
    if (!editing && mode === 'upload' && !read) await readDocument();
  };

  /* The form as a scan draft, so the phone's checks run on it unchanged. */
  const asScanDraft = (): ScanDraft => ({
    supplierName: newSupplier.name,
    supplierTaxId: newSupplier.taxId,
    reference: draft.reference,
    date: draft.date,
    vatRate: Number(draft.vatRate) || 0,
    lines: draft.lines.map((l) => ({ desc: l.desc, qty: l.qty, unitPrice: l.unitPrice, flags: flags[l.uid] ?? [] })),
    invoice: read?.invoice ?? { subtotal: null, vat: null, total: null },
    converted: read?.converted ?? null,
    documentDiscount: read?.documentDiscount ?? null,
    vatBasis: read?.vatBasis ?? 'vat_on_document',
  });

  const existingSupplier = draft.supplierId && draft.supplierId !== NEW_SUPPLIER ? draft.supplierId : null;
  const checks = read ? scanChecks(asScanDraft(), { supplierChosen: existingSupplier != null }) : null;
  const taxIdInvalid = draft.supplierId === NEW_SUPPLIER && Boolean(checks?.taxIdInvalid);

  const subtotal = draftSubtotal(draft.lines);
  const totals = previewTotals(String(subtotal), draft.vatRate);
  const vatPercent = Math.round((Number(draft.vatRate) || 0) * 100);
  const supplierOk = existingSupplier != null
    || (draft.supplierId === NEW_SUPPLIER && newSupplier.name.trim().length > 0);
  const mismatchBlocks = checks?.mismatch != null && !acceptMismatch;
  const canSave = supplierOk && Boolean(draft.date) && Boolean(draft.category)
    && !readyLines(draft.lines).incomplete && subtotal > 0 && !mismatchBlocks && !doc.reading;

  const patchLine = (uid: string, over: Partial<DraftLine>) => {
    setDraft((prev) => ({ ...prev, lines: prev.lines.map((l) => (l.uid === uid ? { ...l, ...over } : l)) }));
    const touched = Object.keys(over) as LineFlag[];
    setFlags((prev) => (prev[uid] ? { ...prev, [uid]: prev[uid].filter((f) => !touched.includes(f)) } : prev));
  };
  const addLine = () => setDraft((prev) => ({ ...prev, lines: [...prev.lines, blankLine()] }));
  const removeLine = (uid: string) =>
    setDraft((prev) => ({ ...prev, lines: prev.lines.filter((l) => l.uid !== uid) }));

  const spreadDiscount = () => {
    const spread = applyDocumentDiscount(asScanDraft());
    setDraft((prev) => ({
      ...prev,
      lines: spread.lines.map((l) => ({ ...blankLine(), desc: l.desc, qty: l.qty, unitPrice: l.unitPrice })),
    }));
    setFlags({});
    setRead((r) => (r ? { ...r, documentDiscount: null } : r));
  };

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

  const saveNewWithDocument = async (allowDuplicate: boolean): Promise<void> => {
    setSaving(true);
    try {
      await run('busy.savingExpense', async () => saveScannedExpense({
        scanId: (await doc.finishUploads()).id,
        supplierId: existingSupplier,
        supplierName: newSupplier.name,
        supplierTaxId: newSupplier.taxId,
        draft: asScanDraft(),
        paid: draft.paid,
        dueDate: draft.dueDate || null,
        chequeNumber: draft.chequeNumber || null,
        chequeDate: draft.chequeDate || null,
        category: draft.category,
        description: draft.description,
        pages: doc.names,
        allowDuplicate,
      }));
      dispatch(showSuccess('expenses.saved'));
      onSavedWithDocument();
      onClose();
    } catch (e) {
      if (e instanceof DuplicateInvoiceError) {
        setSaving(false);
        const again = await confirm({ titleKey: 'expenses.doc.dupTitle', bodyKey: 'expenses.doc.dupBody', danger: true });
        if (again) await saveNewWithDocument(true);
        return;
      }
      dispatch(showError(e));
    } finally {
      setSaving(false);
    }
  };

  /** Changes to an expense opened from the list, and the document if one was
   *  attached just now. */
  const saveChanges = async () => {
    if (!expense || !onUpdate) return;
    if (!(await onUpdate(expense.id, draft))) return;
    if (hasNewDoc) {
      setSaving(true);
      try {
        await run('busy.attachingDocument', async () =>
          attachExpenseDocument(expense.id, (await doc.finishUploads()).id, doc.names));
        onSavedWithDocument();
      } catch (e) {
        dispatch(showError(e));
        return;
      } finally {
        setSaving(false);
      }
    }
    onClose();
  };

  const save = async () => {
    if (!canSave || busy || saving) return;
    if (editing) return saveChanges();
    if (hasNewDoc) return saveNewWithDocument(false);
    if (await onSave(draft)) onClose();
  };

  const footerCheck = (() => {
    if (!checks || checks.expected == null) return null;
    if (checks.mismatch == null) {
      return <div className={`${styles.check} ${styles.checkOk}`}>{t('expenses.doc.match')}</div>;
    }
    return (
      <div className={`${styles.check} ${styles.checkBad}`}>
        <div>
          {t('expenses.doc.linesVsDoc', { lines: money(checks.linesSubtotal), doc: money(checks.expected) })}
          {' · '}
          {checks.mismatch < 0
            ? t('expenses.doc.short', { amount: money(-checks.mismatch) })
            : t('expenses.doc.over', { amount: money(checks.mismatch) })}
        </div>
        <CheckboxField
          label="expenses.doc.acceptMismatch"
          checked={acceptMismatch}
          onChange={(e) => setAcceptMismatch(e.target.checked)}
        />
      </div>
    );
  })();

  const vatNote = read && (Number(draft.vatRate) === 0
    ? (read.vatBasis === 'exempt_dealer' ? 'expenses.doc.vatExempt'
      : read.vatBasis === 'no_vat_on_document' ? 'expenses.doc.vatNoneFound' : null)
    : (read.vatBasis === 'unclear' ? 'expenses.doc.vatUnclear' : null));

  /* A new expense, before it has a document: upload or type. */
  const modeToggle = !editing && !hasNewDoc && (
    <div className={styles.modes} role="tablist">
      <button type="button" role="tab" aria-selected={mode === 'upload'}
        className={mode === 'upload' ? styles.modeOn : styles.mode} onClick={() => setMode('upload')}>
        {t('expenses.doc.modeUpload')}
      </button>
      <button type="button" role="tab" aria-selected={mode === 'manual'}
        className={mode === 'manual' ? styles.modeOn : styles.mode} onClick={() => setMode('manual')}>
        {t('expenses.doc.modeManual')}
      </button>
    </div>
  );

  const form = (
    <form className={styles.form} onSubmit={(e) => { e.preventDefault(); void save(); }}>
      {read?.response.duplicate_of && <div className={styles.bannerBad}>{t('expenses.doc.duplicate')}</div>}
      {read?.response.extraction.unreadable && (
        <div className={styles.bannerWarn}>{t('expenses.doc.unreadable', { text: read.response.extraction.unreadable })}</div>
      )}

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h4 className={styles.sectionTitle}>{t('expenses.drawer.details')}</h4>
          {!editing && hasNewDoc && (
            <Button size="sm" disabled={doc.reading} onClick={() => void readDocument()}>
              {read ? t('expenses.doc.readAgain') : t('expenses.doc.read')}
            </Button>
          )}
        </div>
        <SelectField
          label="expenses.fields.supplier" required data-autofocus {...set('supplierId')}
          hint={matchedBy === 'tax_id' ? 'expenses.doc.matchedTax' : matchedBy === 'name' ? 'expenses.doc.matchedName' : undefined}
          className={matchedBy === 'name' ? styles.warn : undefined}
        >
          <option value="">{t('expenses.pickSupplier')}</option>
          {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          {!editing && <option value={NEW_SUPPLIER}>{t('expenses.doc.newSupplier')}</option>}
        </SelectField>
        {draft.supplierId === NEW_SUPPLIER && (
          <div className={styles.pair}>
            <TextField
              label="expenses.doc.supplierName" required value={newSupplier.name}
              onChange={(e) => setNewSupplier((s) => ({ ...s, name: e.target.value }))}
            />
            <TextField
              label="expenses.doc.taxId" inputMode="numeric" dir="ltr" value={newSupplier.taxId}
              error={taxIdInvalid ? t('expenses.doc.taxIdInvalid') : undefined}
              onChange={(e) => setNewSupplier((s) => ({ ...s, taxId: e.target.value }))}
            />
          </div>
        )}
        <div className={styles.pair}>
          <TextField label="expenses.fields.date" required type="date" {...set('date')}
            className={read && !draft.date ? styles.warn : undefined} />
          <TextField label="expenses.drawer.reference" {...set('reference')} />
        </div>
        <div className={styles.pair}>
          <SelectField label="expenses.fields.category" required {...set('category')}
            className={read && !draft.category ? styles.warn : undefined}>
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
        {read?.converted === 'from_incl_vat' && <div className={styles.bannerInfo}>{t('expenses.doc.convertedInclVat')}</div>}
        {read?.documentDiscount != null && (
          <div className={styles.bannerWarn}>
            {t('expenses.doc.discount', { amount: money(read.documentDiscount) })}{' '}
            <Button size="sm" onClick={spreadDiscount}>{t('expenses.doc.discountApply')}</Button>
          </div>
        )}
        <div className={`${styles.line} ${styles.lineLabels}`} aria-hidden="true">
          <span>{t('expenses.lines.desc')}</span>
          <span>{t('expenses.lines.qty')}</span>
          <span>{t('expenses.lines.unitPrice')}</span>
          <span>{t('expenses.lines.total')}</span>
          <span />
        </div>
        {draft.lines.map((l) => {
          const f = flags[l.uid] ?? [];
          return (
            <div className={styles.line} key={l.uid}>
              <input
                value={l.desc}
                className={f.includes('desc') ? styles.inputWarn : undefined}
                placeholder={t('expenses.lines.descPlaceholder')}
                aria-label={t('expenses.lines.desc')}
                onChange={(e) => patchLine(l.uid, { desc: e.target.value })}
              />
              <input
                inputMode="decimal"
                className={f.includes('qty') ? styles.inputWarn : undefined}
                aria-label={t('expenses.lines.qty')}
                value={l.qty}
                onChange={(e) => patchLine(l.uid, { qty: e.target.value })}
              />
              <input
                inputMode="decimal"
                className={f.includes('unitPrice') ? styles.inputWarn : undefined}
                aria-label={t('expenses.lines.unitPrice')}
                placeholder="₪"
                value={l.unitPrice}
                onChange={(e) => patchLine(l.uid, { unitPrice: e.target.value })}
              />
              <span className={styles.lineTotal}>
                {money(lineQty(l.qty) * (Number(l.unitPrice) || 0))}
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
          );
        })}
        <button type="button" className={styles.addRow} onClick={addLine}>
          ＋ {t('expenses.lines.add')}
        </button>
      </section>

      <section className={styles.section}>
        <h4 className={styles.sectionTitle}>{t('expenses.drawer.payment')}</h4>
        <div className={styles.pair}>
          <SelectField label="expenses.drawer.vat" required {...set('vatRate')}
            className={read?.vatBasis === 'unclear' ? styles.warn : undefined}>
            <option value={String(VAT)}>18%</option>
            <option value="0">{t('expenses.vatNone')}</option>
          </SelectField>
          {/* Blank is on receipt, the common case — left blank rather than
              pre-filled, which would be an answer nobody gave. This is what
              ages the bill in the obligo and aging reports. */}
          <TextField label="expenses.fields.dueDate" hint="expenses.dueDateHint" type="date" {...set('dueDate')} />
        </div>
        {vatNote && <p className={styles.note}>{t(vatNote)}</p>}
        {checks?.vatMismatch && <p className={styles.note}>{t('expenses.doc.vatOff')}</p>}
        {/* The cheque number is always offered (2026-11-15): it used to
            appear only once "paid" was ticked, and nobody found it there. */}
        <div className={styles.pair}>
          <TextField label="expenses.fields.chequeNumber" inputMode="numeric" dir="ltr" {...set('chequeNumber')} />
          <div />
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
            <TextField label="expenses.fields.chequeDate" hint="expenses.chequeDateHint" type="date" {...set('chequeDate')} />
            <div />
          </div>
        )}
      </section>

      {/* Typing a new expense: the invoice can still go with it, unread. */}
      {!editing && mode === 'manual' && !hasNewDoc && (
        <section className={styles.section}>
          <DropZone size="small" title="expenses.doc.attachOptional" body="expenses.doc.attachOptionalBody"
            onFiles={(f) => void addFiles(f)} />
        </section>
      )}

      <div className={styles.summary}>
        <div><span>{t('expenses.fields.subtotal')}</span><span>{money(totals.subtotal)}</span></div>
        <div>
          <span>{vatPercent ? t('expenses.drawer.vatLine', { percent: vatPercent }) : t('expenses.vatNone')}</span>
          <span>{money(totals.vat)}</span>
        </div>
        <div className={styles.grand}><span>{t('expenses.drawer.total')}</span><span>{money(totals.total)}</span></div>
      </div>
      {footerCheck}
      {/* Enter in a field saves, as it did in the old inline form. */}
      <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
    </form>
  );

  /* While the document is uploaded and read, the form waits under a spinner;
     the document beside it stays in view, to look over in the meantime. */
  const readingOverlay = doc.reading && (
    <div className={styles.readingOverlay} role="status" aria-live="polite">
      <span className={styles.spinner} aria-hidden="true" />
      <strong>{doc.uploading ? t('expenses.doc.uploadingDoc') : t('expenses.doc.reading')}</strong>
      <span className={styles.readingHint}>{t('expenses.doc.readingHint')}</span>
    </div>
  );

  /* The document column: what is on file, what was just added, or where to
     drop one. */
  const documentColumn = onFile && onFile.length > 0 ? (
    <DocumentPane files={onFile.map((f) => ({ key: f.name, url: f.url, kind: f.kind }))} />
  ) : hasNewDoc ? (
    <DocumentPane
      files={doc.files.map((f) => ({ key: f.name, url: f.previewUrl, kind: f.kind, status: f.upload }))}
      canAdd={!doc.reading}
      onAdd={(f) => void addFiles(f)}
      onRemove={doc.reading ? undefined : doc.remove}
    />
  ) : editing && !expense?.scanId ? (
    <DropZone title="expenses.doc.noDocTitle" body="expenses.doc.noDocBody" onFiles={(f) => void addFiles(f)} />
  ) : null;

  /* A new expense in "upload the invoice" mode shows only where to drop it —
     the form comes once there is something to fill it from. */
  const body = !editing && !hasNewDoc && mode === 'upload' ? (
    <>
      {modeToggle}
      <div className={styles.uploadOnly}>
        <DropZone title="expenses.doc.dropTitle" body="expenses.doc.dropBody" onFiles={(f) => void addFiles(f)} />
        <p className={styles.uploadHint}>{t('expenses.doc.dropHint')}</p>
      </div>
    </>
  ) : wide ? (
    <div className={styles.withDoc}>
      <div className={styles.formColumn}>{modeToggle}{form}{readingOverlay}</div>
      <div className={styles.docColumn}>{documentColumn}</div>
    </div>
  ) : (
    <>{modeToggle}{form}</>
  );

  return (
    <Modal
      title={editing ? 'expenses.doc.editTitle' : 'expenses.drawer.title'}
      titleValues={editing ? { supplier: expense.supplierName ?? '', reference: expense.reference ?? '' } : undefined}
      variant="drawer"
      wide={wide}
      isTop={!pickerUp}
      onClose={onClose}
      actions={
        <>
          <Button variant="primary" className={styles.save} disabled={busy || saving || !canSave} onClick={() => void save()}>
            {busy || saving ? t('expenses.saving') : editing ? t('expenses.doc.saveChanges') : t('expenses.drawer.save')}
          </Button>
          <Button onClick={onClose}>{editing ? t('common.close') : t('common.cancel')}</Button>
          {editing && onPrint && <Button onClick={() => onPrint(expense)}>{t('expenses.print')}</Button>}
          {editing && onDelete && (
            <Button variant="ghostDanger" onClick={() => void onDelete(expense).then((gone) => { if (gone) onClose(); })}>
              <IconTrash /> {t('expenses.doc.delete')}
            </Button>
          )}
        </>
      }
    >
      {body}
    </Modal>
  );
}
