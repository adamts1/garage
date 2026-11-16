/* The new-expense form, as a drawer beside the list (2026-11-11 redesign).

   Rendered by the page rather than opened through the modal registry: saving
   can fail, and a registry modal hands its answer back by closing — so a failed
   save would throw away everything typed. Here the drawer stays up until the
   save has gone through.

   The part picker it opens does go through the registry, so this one steps
   down (isTop false) while the picker is up, and Escape closes only the picker.

   THE DOCUMENT (2026-11-16)

   An expense can carry the supplier's document it was entered from — photos or
   a PDF. Attached here, the drawer widens: the document on one side, the form
   on the other. "Fill from the document" has the model read it
   (extract-invoice) and fills the form; what failed a check is marked amber
   and the lines are compared with the document's own totals, as on the phone
   (scanChecks in @garage/shared). Scanning from the list is the same thing
   with the reading started straight away.

   With a document, the expense is saved through save_scanned_expense — one
   transaction that can also create a supplier the garage has not seen yet,
   refuses a duplicate invoice number unless confirmed, and links the document.
   Without one, it is saved as it always was. */

import {
  applyDocumentDiscount, DuplicateInvoiceError, draftFromExtraction, money, saveScannedExpense,
  scanChecks, VAT,
  type ExtractResponse, type PartDef, type ScanDraft, type Supplier,
} from '@garage/shared';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/Button';
import { CheckboxField, SelectField, TextField } from '../../components/Field';
import Modal from '../../components/Modal/Modal';
import { usePickPart } from '../../features/works/usePickers';
import { IconBox, IconTrash } from '../../icons';
import { showError, showErrorKey, showSuccess, useAppDispatch, useAppSelector, useConfirm } from '../../store';
import { DocumentPane } from './DocumentPane';
import styles from './ExpenseDrawer.module.css';
import { useExpenseDocument, type DocError } from './useExpenseDocument';
import {
  blankExpense, blankLine, draftSubtotal, lineQty, previewTotals, readyLines,
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
  /** Saved with a document, through save_scanned_expense — the list reloads. */
  onSavedWithDocument: () => void;
  onClose: () => void;
  /** The date the last expense was entered with — a stack of one day's
   *  invoices is the normal way this screen is used. */
  initialDate?: string;
  /** Opened by "scan an invoice": these files are the document, and reading
   *  starts at once. */
  scanFiles?: File[];
}

export default function ExpenseDrawer({
  suppliers, usedCategories, busy, onSave, onSavedWithDocument, onClose, initialDate, scanFiles,
}: ExpenseDrawerProps) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const confirm = useConfirm();
  const pickPart = usePickPart();
  const pickerUp = useAppSelector((s) => s.modal.stack.length > 0);
  const doc = useExpenseDocument();
  const [draft, setDraft] = useState<ExpenseDraft>(() => ({
    ...blankExpense(), ...(initialDate ? { date: initialDate } : {}),
  }));
  const [newSupplier, setNewSupplier] = useState({ name: '', taxId: '' });
  const [matchedBy, setMatchedBy] = useState<'tax_id' | 'name' | null>(null);
  const [read, setRead] = useState<ReadState | null>(null);
  const [flags, setFlags] = useState<Record<string, LineFlag[]>>({});
  const [acceptMismatch, setAcceptMismatch] = useState(false);
  const [saving, setSaving] = useState(false);
  const started = useRef(false);

  const hasDoc = doc.files.length > 0;

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

  // "Scan an invoice": the files came with the drawer; read them straight away.
  useEffect(() => {
    if (!scanFiles?.length || started.current) return;
    started.current = true;
    void (async () => {
      sayDocError(await doc.add(scanFiles));
      if (scanFiles.length) await readDocument();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanFiles]);

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

  const saveWithDocument = async (allowDuplicate: boolean): Promise<void> => {
    setSaving(true);
    try {
      const scan = await doc.finishUploads();
      await saveScannedExpense({
        scanId: scan.id,
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
      });
      dispatch(showSuccess('expenses.saved'));
      onSavedWithDocument();
      onClose();
    } catch (e) {
      if (e instanceof DuplicateInvoiceError) {
        setSaving(false);
        const again = await confirm({ titleKey: 'expenses.doc.dupTitle', bodyKey: 'expenses.doc.dupBody', danger: true });
        if (again) await saveWithDocument(true);
        return;
      }
      dispatch(showError(e));
    } finally {
      setSaving(false);
    }
  };

  const save = async () => {
    if (!canSave || busy || saving) return;
    if (hasDoc) {
      await saveWithDocument(false);
      return;
    }
    if (await onSave(draft)) onClose();
  };

  const footer = (() => {
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

  const form = (
    <form className={styles.form} onSubmit={(e) => { e.preventDefault(); void save(); }}>
      {doc.reading && <div className={styles.reading}>{t('expenses.doc.reading')}</div>}
      {read?.response.duplicate_of && <div className={styles.bannerBad}>{t('expenses.doc.duplicate')}</div>}
      {read?.response.extraction.unreadable && (
        <div className={styles.bannerWarn}>{t('expenses.doc.unreadable', { text: read.response.extraction.unreadable })}</div>
      )}

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h4 className={styles.sectionTitle}>{t('expenses.drawer.details')}</h4>
          {!hasDoc ? (
            <label className={styles.attach}>
              {t('expenses.doc.attach')}
              <input
                type="file" accept="image/*,application/pdf" multiple hidden
                onChange={(e) => { const f = [...(e.target.files ?? [])]; e.target.value = ''; void doc.add(f).then(sayDocError); }}
              />
            </label>
          ) : (
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
          <option value={NEW_SUPPLIER}>{t('expenses.doc.newSupplier')}</option>
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

      <div className={styles.summary}>
        <div><span>{t('expenses.fields.subtotal')}</span><span>{money(totals.subtotal)}</span></div>
        <div>
          <span>{vatPercent ? t('expenses.drawer.vatLine', { percent: vatPercent }) : t('expenses.vatNone')}</span>
          <span>{money(totals.vat)}</span>
        </div>
        <div className={styles.grand}><span>{t('expenses.drawer.total')}</span><span>{money(totals.total)}</span></div>
      </div>
      {footer}
      {/* Enter in a field saves, as it did in the old inline form. */}
      <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
    </form>
  );

  return (
    <Modal
      title={scanFiles?.length ? 'expenses.doc.scanTitle' : 'expenses.drawer.title'}
      variant="drawer"
      wide={hasDoc}
      isTop={!pickerUp}
      onClose={onClose}
      actions={
        <>
          <Button variant="primary" className={styles.save} disabled={busy || saving || !canSave} onClick={() => void save()}>
            {busy || saving ? t('expenses.saving') : t('expenses.drawer.save')}
          </Button>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
        </>
      }
    >
      {hasDoc ? (
        <div className={styles.withDoc}>
          <div className={styles.docColumn}>
            <DocumentPane
              files={doc.files.map((f) => ({ key: f.name, url: f.previewUrl, kind: f.kind, status: f.upload }))}
              canAdd={!doc.reading}
              onAdd={(f) => void doc.add(f).then(sayDocError)}
              onRemove={doc.reading ? undefined : doc.remove}
            />
          </div>
          <div className={styles.formColumn}>{form}</div>
        </div>
      ) : form}
    </Modal>
  );
}
