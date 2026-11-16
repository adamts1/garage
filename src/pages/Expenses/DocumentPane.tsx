/* A supplier's document, shown: one file large, the others as tabs under it.
   Photos as images, PDFs in the browser's own viewer. Beside the expense form
   while one is entered (with add and remove), and on its own when an expense's
   document is opened from the list (read-only). */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/Button';
import { IconTrash } from '../../icons';
import styles from './DocumentPane.module.css';

export interface PaneFile {
  key: string;
  url: string;
  kind: 'image' | 'pdf';
  /** Upload state, while the document is being entered. */
  status?: 'pending' | 'uploading' | 'done' | 'error';
}

export function DocumentPane({
  files,
  onRemove,
  onAdd,
  canAdd = false,
}: {
  files: PaneFile[];
  onRemove?: (key: string) => void;
  /** Files dropped on the pane or chosen from its button. */
  onAdd?: (files: File[]) => void;
  canAdd?: boolean;
}) {
  const { t } = useTranslation();
  const [current, setCurrent] = useState(0);
  const [over, setOver] = useState(false);
  const shown = files[Math.min(current, files.length - 1)];

  const drop = (e: React.DragEvent) => {
    e.preventDefault();
    setOver(false);
    if (onAdd && canAdd) onAdd([...e.dataTransfer.files]);
  };

  return (
    <div
      className={`${styles.pane} ${over ? styles.over : ''}`}
      onDragOver={(e) => { if (onAdd && canAdd) { e.preventDefault(); setOver(true); } }}
      onDragLeave={() => setOver(false)}
      onDrop={drop}
    >
      <div className={styles.view}>
        {!shown ? (
          <p className={styles.empty}>{t('expenses.doc.dropHere')}</p>
        ) : shown.kind === 'pdf' ? (
          <iframe className={styles.pdf} src={shown.url} title={t('expenses.doc.fileN', { n: current + 1 })} />
        ) : (
          <a href={shown.url} target="_blank" rel="noreferrer" className={styles.imageLink}>
            <img className={styles.image} src={shown.url} alt={t('expenses.doc.fileN', { n: current + 1 })} />
          </a>
        )}
      </div>

      <div className={styles.strip}>
        {files.map((f, i) => (
          <div key={f.key} className={`${styles.tab} ${i === current ? styles.active : ''}`}>
            <button type="button" className={styles.tabButton} onClick={() => setCurrent(i)}>
              {f.kind === 'pdf' ? 'PDF' : t('expenses.doc.page')} {i + 1}
              {f.status === 'uploading' || f.status === 'pending' ? ` · ${t('expenses.doc.uploading')}` : ''}
              {f.status === 'error' ? ` · ${t('expenses.doc.uploadFailed')}` : ''}
            </button>
            {onRemove && (
              <Button
                variant="ghostDanger" size="sm"
                aria-label={t('expenses.doc.remove', { n: i + 1 })}
                onClick={() => { onRemove(f.key); setCurrent(0); }}
              >
                <IconTrash />
              </Button>
            )}
          </div>
        ))}
        {onAdd && canAdd && (
          <label className={styles.addFile}>
            ＋ {t('expenses.doc.addFile')}
            <input
              type="file"
              accept="image/*,application/pdf"
              multiple
              hidden
              onChange={(e) => { onAdd([...(e.target.files ?? [])]); e.target.value = ''; }}
            />
          </label>
        )}
        {shown && (
          <a className={styles.open} href={shown.url} target="_blank" rel="noreferrer">
            {t('expenses.doc.openTab')}
          </a>
        )}
      </div>
    </div>
  );
}

/** Where a document is dropped or chosen before there is one. Large as the
 *  "upload an invoice" mode of a new expense; small under a typed one. */
export function DropZone({
  onFiles, title, body, size = 'large', disabled = false,
}: {
  onFiles: (files: File[]) => void;
  /** i18n keys. */
  title: string;
  body: string;
  size?: 'large' | 'small';
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const [over, setOver] = useState(false);
  return (
    <div
      className={`${styles.drop} ${size === 'small' ? styles.dropSmall : ''} ${over ? styles.dropOver : ''}`}
      onDragOver={(e) => { if (!disabled) { e.preventDefault(); setOver(true); } }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); if (!disabled) onFiles([...e.dataTransfer.files]); }}
    >
      <span className={styles.dropIcon} aria-hidden="true">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 16V4" /><path d="M7 9l5-5 5 5" /><path d="M4 20h16" />
        </svg>
      </span>
      <strong className={styles.dropTitle}>{t(title)}</strong>
      <span className={styles.dropBody}>{t(body)}</span>
      <label className={styles.dropButton}>
        {t('expenses.doc.chooseFile')}
        <input
          type="file" accept="image/*,application/pdf" multiple hidden disabled={disabled}
          onChange={(e) => { const f = [...(e.target.files ?? [])]; e.target.value = ''; if (f.length) onFiles(f); }}
        />
      </label>
    </div>
  );
}
