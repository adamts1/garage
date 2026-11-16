/* An expense's document, after the expense is saved: open it, or attach one to
   an expense that was entered without it. Both from the list's row menu. */

import {
  attachExpenseDocument, expenseDocumentFiles, type DocumentFileLink, type SupplierExpense,
} from '@garage/shared';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/Button';
import Modal from '../../components/Modal/Modal';
import { showError, showErrorKey, showSuccess, useAppDispatch } from '../../store';
import { DocumentPane } from './DocumentPane';
import { useExpenseDocument } from './useExpenseDocument';

/** The document an expense was entered from, as it was uploaded. */
export function DocumentViewer({ expense, onClose }: { expense: SupplierExpense; onClose: () => void }) {
  const dispatch = useAppDispatch();
  const [files, setFiles] = useState<DocumentFileLink[] | null>(null);

  useEffect(() => {
    if (!expense.scanId) return;
    let live = true;
    expenseDocumentFiles(expense.scanId)
      .then((f) => { if (live) setFiles(f); })
      .catch((e) => { if (live) { dispatch(showError(e)); setFiles([]); } });
    return () => { live = false; };
  }, [expense.scanId, dispatch]);

  return (
    <Modal
      title="expenses.doc.viewTitle"
      titleValues={{ supplier: expense.supplierName ?? '', reference: expense.reference ?? '' }}
      size="lg"
      onClose={onClose}
    >
      {files == null ? null : (
        <DocumentPane files={files.map((f) => ({ key: f.name, url: f.url, kind: f.kind }))} />
      )}
    </Modal>
  );
}

/** Put a document on an expense saved without one. Not read by the model:
 *  the expense is already what the person typed. */
export function AttachDocument({
  expense, onClose, onAttached,
}: { expense: SupplierExpense; onClose: () => void; onAttached: () => void }) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const doc = useExpenseDocument();
  const [saving, setSaving] = useState(false);

  const attach = async () => {
    setSaving(true);
    try {
      const scan = await doc.finishUploads();
      await attachExpenseDocument(expense.id, scan.id, doc.names);
      dispatch(showSuccess('expenses.doc.attached'));
      onAttached();
      onClose();
    } catch (e) {
      dispatch(showError(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title="expenses.doc.attachTitle"
      titleValues={{ supplier: expense.supplierName ?? '', reference: expense.reference ?? '' }}
      size="lg"
      onClose={onClose}
      actions={
        <>
          <Button variant="primary" disabled={saving || doc.files.length === 0} onClick={() => void attach()}>
            {saving ? t('expenses.saving') : t('expenses.doc.attachSave')}
          </Button>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
        </>
      }
    >
      <DocumentPane
        files={doc.files.map((f) => ({ key: f.name, url: f.previewUrl, kind: f.kind, status: f.upload }))}
        canAdd
        onAdd={(f) => void doc.add(f).then((err) => { if (err) dispatch(showErrorKey(`expenses.doc.error.${err}`)); })}
        onRemove={doc.remove}
      />
    </Modal>
  );
}
