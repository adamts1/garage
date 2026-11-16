/* The whole life of one scanned invoice on the phone: pages → upload → reading
   → review → saved.

   Each page starts uploading the moment it is taken, one at a time in the
   background, while the next one is being photographed — so by סיום most of
   the upload is already done and only the reading is left to wait for. A page
   keeps its own name from the start; deleting, retaking or moving one changes
   only the list, which is handed over at סיום as the invoice's page order.

   The pages stay on the phone until every one of them is uploaded, so a
   dropped connection is a retry, not a re-photograph. Once read, the review is
   kept as a draft in AsyncStorage on every edit: leaving the screen — a call,
   a customer at the counter — and coming back finds it where it was. The
   server keeps its own copy of the reading on the scan row, so a retry of the
   reading itself costs nothing either (see extract-invoice). */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  draftFromExtraction, extractScan, newScanPageName, saveScannedExpense, ScanExtractError,
  SCAN_MAX_PAGES, signScanPages, startScan, uploadScanPage,
  type ExtractResponse, type SaveScanInput, type ScanDraft, type ScanStart, type SupplierMatch,
} from '@garage/shared';
import type { LocalPage } from './scanPages';

/* v2: pages are named, not numbered. A v1 draft is from a build that never
   reached anyone, so it is simply not read. */
const DRAFT_KEY = 'invoice-scan-draft-v2';

export type ScanStage = 'capture' | 'uploading' | 'reading' | 'failed' | 'review';

export type PageUpload = 'pending' | 'uploading' | 'done' | 'error';

export interface ScanPage extends LocalPage {
  /** Its object name in the scan's folder, fixed when it was taken. */
  name: string;
  upload: PageUpload;
}

/** What the person decided on the review screen, beside the draft itself. */
export interface ReviewChoices {
  /** An existing supplier, or null for the new one in the draft. */
  supplierId: string | null;
  supplierLabel: string | null;
  matchedBy: SupplierMatch['by'] | null;
  paid: boolean;
  chequeNumber: string;
  /** Saw the sum mismatch and saves anyway. */
  acceptMismatch: boolean;
}

interface Stored {
  scan: ScanStart;
  pages: string[];
  response: ExtractResponse;
  draft: ScanDraft;
  choices: ReviewChoices;
}

const choicesFrom = (r: ExtractResponse): ReviewChoices => ({
  supplierId: r.supplier?.id ?? null,
  supplierLabel: r.supplier?.name ?? null,
  matchedBy: r.supplier?.by ?? null,
  paid: false,
  chequeNumber: '',
  acceptMismatch: false,
});

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function useInvoiceScan() {
  const [stage, setStage] = useState<ScanStage>('capture');
  const [pages, setPages] = useState<ScanPage[]>([]);
  const [error, setError] = useState<{ message: string; retryable: boolean } | null>(null);
  const [response, setResponse] = useState<ExtractResponse | null>(null);
  const [draft, setDraft] = useState<ScanDraft | null>(null);
  const [choices, setChoices] = useState<ReviewChoices | null>(null);
  const [pageUrls, setPageUrls] = useState<string[]>([]);
  const [restoring, setRestoring] = useState(true);
  /** Bumped when an upload ends, so the queue looks for the next page. */
  const [queueTick, setQueueTick] = useState(0);

  const pagesRef = useRef<ScanPage[]>([]);
  pagesRef.current = pages;
  const scanRef = useRef<ScanStart | null>(null);
  const scanPromise = useRef<Promise<ScanStart> | null>(null);
  const inFlight = useRef(false);
  /** The page order that was read — what the draft's images are. */
  const readPages = useRef<string[]>([]);
  /** Set when the person leaves mid-reading, so a late answer is dropped. */
  const abandoned = useRef(false);

  /** The scan row, created once, on the first page. A failure is not kept: the
   *  next upload, or סיום, asks again. */
  const ensureScan = useCallback(() => {
    if (scanRef.current) return Promise.resolve(scanRef.current);
    if (!scanPromise.current) {
      scanPromise.current = startScan()
        .then((s) => { scanRef.current = s; return s; })
        .catch((e) => { scanPromise.current = null; throw e; });
    }
    return scanPromise.current;
  }, []);

  const mark = useCallback((name: string, upload: PageUpload) => {
    setPages((p) => p.map((x) => (x.name === name ? { ...x, upload } : x)));
  }, []);

  const uploadOne = useCallback(async (page: ScanPage) => {
    mark(page.name, 'uploading');
    try {
      const scan = await ensureScan();
      await uploadScanPage(scan, page.name, page.base64);
      mark(page.name, 'done');
      return true;
    } catch {
      mark(page.name, 'error');
      return false;
    }
  }, [ensureScan, mark]);

  /* The background queue: one upload at a time — parallel uploads on a
     garage's wifi are how ticket photos used to time out. A page that failed
     here waits for סיום, which tries it again. */
  useEffect(() => {
    if (stage !== 'capture' || inFlight.current) return;
    const next = pages.find((p) => p.upload === 'pending');
    if (!next) return;
    inFlight.current = true;
    void uploadOne(next).finally(() => {
      inFlight.current = false;
      setQueueTick((n) => n + 1);
    });
  }, [stage, pages, queueTick, uploadOne]);

  // A draft left from last time opens straight into its review.
  useEffect(() => {
    let live = true;
    AsyncStorage.getItem(DRAFT_KEY)
      .then(async (raw) => {
        if (!raw || !live) return;
        const saved = JSON.parse(raw) as Stored;
        scanRef.current = saved.scan;
        readPages.current = saved.pages;
        setResponse(saved.response);
        setDraft(saved.draft);
        setChoices(saved.choices);
        setStage('review');
        signScanPages(saved.scan, saved.pages).then((u) => { if (live) setPageUrls(u); }).catch(() => {});
      })
      .catch(() => {})
      .finally(() => { if (live) setRestoring(false); });
    return () => { live = false; };
  }, []);

  // Every edit of the review is the draft.
  useEffect(() => {
    if (stage !== 'review' || !draft || !choices || !response || !scanRef.current) return;
    const stored: Stored = { scan: scanRef.current, pages: readPages.current, response, draft, choices };
    void AsyncStorage.setItem(DRAFT_KEY, JSON.stringify(stored));
  }, [stage, draft, choices, response]);

  const fresh = (page: LocalPage): ScanPage => ({ ...page, name: newScanPageName(), upload: 'pending' });

  const addPage = useCallback((page: LocalPage) => {
    setPages((p) => (p.length >= SCAN_MAX_PAGES ? p : [...p, fresh(page)]));
  }, []);
  /** A retake is a new page under a new name: the old one may already be up. */
  const replacePage = useCallback((i: number, page: LocalPage) => {
    setPages((p) => p.map((x, j) => (j === i ? fresh(page) : x)));
  }, []);
  const removePage = useCallback((i: number) => {
    setPages((p) => p.filter((_, j) => j !== i));
  }, []);
  /** Towards the start (-1) or the end (+1). */
  const movePage = useCallback((i: number, dir: -1 | 1) => {
    setPages((p) => {
      const j = i + dir;
      if (j < 0 || j >= p.length) return p;
      const next = [...p];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }, []);

  /** Finish what is not up yet, then read. Safe to call again after a failure:
   *  only the pages that did not make it are sent again. */
  const submit = useCallback(async () => {
    if (pagesRef.current.length === 0) return;
    abandoned.current = false;
    setError(null);
    setStage('uploading');
    try {
      // The background upload in progress finishes first; nothing runs twice.
      while (inFlight.current) await wait(100);
      for (const page of pagesRef.current) {
        if (page.upload === 'done') continue;
        if (!(await uploadOne(page))) throw new Error('upload failed');
      }
      const scan = await ensureScan();
      const order = pagesRef.current.map((p) => p.name);

      setStage('reading');
      const r = await extractScan(scan.id, order);
      if (abandoned.current) return;
      readPages.current = order;
      setResponse(r);
      setDraft(draftFromExtraction(r.extraction));
      setChoices(choicesFrom(r));
      setStage('review');
      signScanPages(scan, order).then(setPageUrls).catch(() => {});
    } catch (e) {
      if (abandoned.current) return;
      const retryable = e instanceof ScanExtractError ? e.retryable : true;
      setError({ message: e instanceof Error ? e.message : String(e), retryable });
      setStage('failed');
    }
  }, [ensureScan, uploadOne]);

  /** Nothing the model read could be used: review an empty draft by hand, with
   *  the pages still attached. */
  const reviewByHand = useCallback(async () => {
    const scan = scanRef.current;
    if (!scan) return;
    const empty: ExtractResponse = {
      scan_id: scan.id, supplier: null, duplicate_of: null, model: '',
      extraction: {
        supplier_name: null, supplier_tax_id: null, exempt_dealer: false, document_type: null,
        invoice_number: null, invoice_date: null, prices_include_vat: null,
        lines: [{ desc: null, qty: null, unit_price: null, line_total: null }],
        document_discount: null, subtotal: null, vat_amount: null, total: null, unreadable: null,
      },
    };
    const order = pagesRef.current.filter((p) => p.upload === 'done').map((p) => p.name);
    readPages.current = order;
    setResponse(empty);
    setDraft(draftFromExtraction(empty.extraction));
    setChoices(choicesFrom(empty));
    setError(null);
    setStage('review');
    if (order.length > 0) signScanPages(scan, order).then(setPageUrls).catch(() => {});
  }, []);

  const save = useCallback(async (allowDuplicate: boolean) => {
    const scan = scanRef.current;
    if (!scan || !draft || !choices) throw new Error('nothing to save');
    const input: SaveScanInput = {
      scanId: scan.id,
      supplierId: choices.supplierId,
      supplierName: draft.supplierName,
      supplierTaxId: draft.supplierTaxId,
      draft,
      paid: choices.paid,
      chequeNumber: choices.chequeNumber,
      allowDuplicate,
      /* The pages as read — or, entered by hand after a failed reading, the
         pages that made it up — so the expense always has its document. */
      pages: readPages.current,
    };
    const id = await saveScannedExpense(input);
    await AsyncStorage.removeItem(DRAFT_KEY);
    return id;
  }, [draft, choices]);

  /** Throw the scan away on the phone. The row and pages stay on the server,
   *  unsaved, as the record of a scan that was not used. */
  const discard = useCallback(async () => {
    abandoned.current = true;
    await AsyncStorage.removeItem(DRAFT_KEY);
  }, []);

  const uploaded = pages.filter((p) => p.upload === 'done').length;

  return {
    stage, restoring, pages, uploaded, error, response, draft, choices, pageUrls,
    addPage, replacePage, removePage, movePage, submit, reviewByHand, save, discard,
    setDraft, setChoices,
  };
}
