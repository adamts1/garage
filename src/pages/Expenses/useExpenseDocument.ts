/* The document behind an expense, on the web: the supplier's invoice as files
   — photos or a PDF — uploaded as soon as they are chosen, and read by the
   model when asked.

   The browser's counterpart to the phone's useInvoiceScan. Same server, same
   rules: an expense_scans row holds the document, its files go to
   expense-scans/{garage}/{scan}/{name}, extract-invoice reads them in the order
   given. A photo is shrunk here to 1568 px (the most the model reads at); a
   PDF goes as the supplier sent it, since the model reads PDFs as they are. */

import {
  extractScan, isPdfPage, newScanPageName, SCAN_MAX_PAGES, startScan, uploadScanFile,
  type ExtractResponse, type ScanStart,
} from '@garage/shared';
import { useCallback, useEffect, useRef, useState } from 'react';

/** What the model reads at most; past this a photo is only a slower upload. */
const MAX_EDGE = 1568;
const QUALITY = 0.82;
/** The bucket's limit (20261116120000). Said before uploading, not after. */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

export type FileUpload = 'pending' | 'uploading' | 'done' | 'error';

export interface DocFile {
  name: string;
  kind: 'image' | 'pdf';
  /** What is uploaded: the shrunk JPEG, or the PDF itself. */
  data: Blob;
  /** For showing it before it is uploaded. Revoked when it goes. */
  previewUrl: string;
  upload: FileUpload;
}

export type DocError = 'too_many' | 'too_big' | 'unsupported';

/** A photo as a JPEG no larger than the model reads. HEIC and other formats
 *  the browser cannot draw are refused rather than uploaded unreadable. */
async function shrinkImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas unavailable');
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('could not encode'))), 'image/jpeg', QUALITY));
}

export function useExpenseDocument() {
  const [files, setFiles] = useState<DocFile[]>([]);
  const [reading, setReading] = useState(false);
  const [tick, setTick] = useState(0);
  const filesRef = useRef<DocFile[]>([]);
  filesRef.current = files;
  const scanRef = useRef<ScanStart | null>(null);
  const scanPromise = useRef<Promise<ScanStart> | null>(null);
  const inFlight = useRef(false);

  // Object URLs belong to this document; let them go with it.
  useEffect(() => () => filesRef.current.forEach((f) => URL.revokeObjectURL(f.previewUrl)), []);

  const ensureScan = useCallback(() => {
    if (scanRef.current) return Promise.resolve(scanRef.current);
    if (!scanPromise.current) {
      scanPromise.current = startScan()
        .then((s) => { scanRef.current = s; return s; })
        .catch((e) => { scanPromise.current = null; throw e; });
    }
    return scanPromise.current;
  }, []);

  const mark = useCallback((name: string, upload: FileUpload) => {
    setFiles((fs) => fs.map((f) => (f.name === name ? { ...f, upload } : f)));
  }, []);

  const uploadOne = useCallback(async (f: DocFile) => {
    mark(f.name, 'uploading');
    try {
      await uploadScanFile(await ensureScan(), f.name, f.data);
      mark(f.name, 'done');
      return true;
    } catch {
      mark(f.name, 'error');
      return false;
    }
  }, [ensureScan, mark]);

  // One upload at a time, in the background, as files are added.
  useEffect(() => {
    if (inFlight.current) return;
    const next = files.find((f) => f.upload === 'pending');
    if (!next) return;
    inFlight.current = true;
    void uploadOne(next).finally(() => { inFlight.current = false; setTick((n) => n + 1); });
  }, [files, tick, uploadOne]);

  /** Add files. Returns what was refused, if anything, for the caller to say. */
  const add = useCallback(async (picked: readonly File[]): Promise<DocError | null> => {
    let refused: DocError | null = null;
    const room = SCAN_MAX_PAGES - filesRef.current.length;
    if (picked.length > room) refused = 'too_many';
    const added: DocFile[] = [];
    for (const file of picked.slice(0, Math.max(0, room))) {
      const pdf = file.type === 'application/pdf' || isPdfPage(file.name);
      try {
        const data = pdf ? file : await shrinkImage(file);
        if (data.size > MAX_FILE_BYTES) { refused = 'too_big'; continue; }
        added.push({
          name: newScanPageName(pdf ? 'pdf' : 'jpg'),
          kind: pdf ? 'pdf' : 'image',
          data,
          previewUrl: URL.createObjectURL(data),
          upload: 'pending',
        });
      } catch {
        refused = 'unsupported';
      }
    }
    if (added.length) setFiles((fs) => [...fs, ...added]);
    return refused;
  }, []);

  const remove = useCallback((name: string) => {
    setFiles((fs) => {
      const gone = fs.find((f) => f.name === name);
      if (gone) URL.revokeObjectURL(gone.previewUrl);
      return fs.filter((f) => f.name !== name);
    });
  }, []);

  /** Everything up, or throw. Waits for the upload in progress, then retries
   *  whatever failed. */
  const finishUploads = useCallback(async (): Promise<ScanStart> => {
    while (inFlight.current) await new Promise((r) => setTimeout(r, 100));
    for (const f of filesRef.current) {
      if (f.upload !== 'done' && !(await uploadOne(f))) throw new Error('upload failed');
    }
    return ensureScan();
  }, [ensureScan, uploadOne]);

  /** Have the model read the document. */
  const read = useCallback(async (): Promise<ExtractResponse> => {
    setReading(true);
    try {
      const scan = await finishUploads();
      return await extractScan(scan.id, filesRef.current.map((f) => f.name));
    } finally {
      setReading(false);
    }
  }, [finishUploads]);

  return {
    files,
    reading,
    uploading: files.some((f) => f.upload === 'pending' || f.upload === 'uploading'),
    names: files.map((f) => f.name),
    add, remove, read, finishUploads,
  };
}
