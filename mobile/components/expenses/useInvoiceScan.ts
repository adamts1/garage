/* The whole life of one scanned invoice on the phone: pages → upload → reading
   → review → saved.

   The pages stay on the phone until every one of them is uploaded, so a
   dropped connection is a retry, not a re-photograph. Once read, the review is
   kept as a draft in AsyncStorage on every edit: leaving the screen — a call,
   a customer at the counter — and coming back finds it where it was. The
   server keeps its own copy of the reading on the scan row, so a retry of the
   reading itself costs nothing either (see extract-invoice). */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  draftFromExtraction, extractScan, saveScannedExpense, ScanExtractError, SCAN_MAX_PAGES,
  signScanPages, startScan, uploadScanPage,
  type ExtractResponse, type SaveScanInput, type ScanDraft, type ScanStart, type SupplierMatch,
} from '@garage/shared';
import type { LocalPage } from './scanPages';

const DRAFT_KEY = 'invoice-scan-draft-v1';

export type ScanStage = 'capture' | 'uploading' | 'reading' | 'failed' | 'review';

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
  pageCount: number;
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

export function useInvoiceScan() {
  const [stage, setStage] = useState<ScanStage>('capture');
  const [pages, setPages] = useState<LocalPage[]>([]);
  const [uploaded, setUploaded] = useState(0);
  const [error, setError] = useState<{ message: string; retryable: boolean } | null>(null);
  const [response, setResponse] = useState<ExtractResponse | null>(null);
  const [draft, setDraft] = useState<ScanDraft | null>(null);
  const [choices, setChoices] = useState<ReviewChoices | null>(null);
  const [pageUrls, setPageUrls] = useState<string[]>([]);
  const [restoring, setRestoring] = useState(true);
  const scanRef = useRef<ScanStart | null>(null);
  const pageCountRef = useRef(0);
  /** Set when the person leaves mid-reading, so a late answer is dropped. */
  const abandoned = useRef(false);

  // A draft left from last time opens straight into its review.
  useEffect(() => {
    let live = true;
    AsyncStorage.getItem(DRAFT_KEY)
      .then(async (raw) => {
        if (!raw || !live) return;
        const saved = JSON.parse(raw) as Stored;
        scanRef.current = saved.scan;
        pageCountRef.current = saved.pageCount;
        setResponse(saved.response);
        setDraft(saved.draft);
        setChoices(saved.choices);
        setStage('review');
        signScanPages(saved.scan, saved.pageCount).then((u) => { if (live) setPageUrls(u); }).catch(() => {});
      })
      .catch(() => {})
      .finally(() => { if (live) setRestoring(false); });
    return () => { live = false; };
  }, []);

  // Every edit of the review is the draft.
  useEffect(() => {
    if (stage !== 'review' || !draft || !choices || !response || !scanRef.current) return;
    const stored: Stored = { scan: scanRef.current, pageCount: pageCountRef.current, response, draft, choices };
    void AsyncStorage.setItem(DRAFT_KEY, JSON.stringify(stored));
  }, [stage, draft, choices, response]);

  const addPage = useCallback((page: LocalPage) => {
    setPages((p) => (p.length >= SCAN_MAX_PAGES ? p : [...p, page]));
  }, []);
  const replacePage = useCallback((i: number, page: LocalPage) => {
    setPages((p) => p.map((x, j) => (j === i ? page : x)));
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

  /** Upload what is not up yet, then read. Safe to call again after a failure:
   *  it carries on from the first page that did not make it. */
  const submit = useCallback(async () => {
    if (pages.length === 0) return;
    abandoned.current = false;
    setError(null);
    try {
      if (!scanRef.current) {
        scanRef.current = await startScan(pages.length);
        pageCountRef.current = pages.length;
        setUploaded(0);
      }
      const scan = scanRef.current;
      setStage('uploading');
      // Sequential, like ticket photos: parallel uploads on a garage's wifi time out.
      for (let n = uploaded; n < pages.length; n++) {
        await uploadScanPage(scan, n + 1, pages[n].base64);
        setUploaded(n + 1);
      }

      setStage('reading');
      const r = await extractScan(scan.id);
      if (abandoned.current) return;
      setResponse(r);
      setDraft(draftFromExtraction(r.extraction));
      setChoices(choicesFrom(r));
      setStage('review');
      signScanPages(scan, pages.length).then(setPageUrls).catch(() => {});
    } catch (e) {
      if (abandoned.current) return;
      const retryable = e instanceof ScanExtractError ? e.retryable : true;
      setError({ message: e instanceof Error ? e.message : String(e), retryable });
      setStage('failed');
    }
  }, [pages, uploaded]);

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
    setResponse(empty);
    setDraft(draftFromExtraction(empty.extraction));
    setChoices(choicesFrom(empty));
    setError(null);
    setStage('review');
    if (uploaded === pageCountRef.current) {
      signScanPages(scan, pageCountRef.current).then(setPageUrls).catch(() => {});
    }
  }, [uploaded]);

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

  return {
    stage, restoring, pages, uploaded, error, response, draft, choices, pageUrls,
    addPage, replacePage, removePage, movePage, submit, reviewByHand, save, discard,
    setDraft, setChoices,
  };
}
