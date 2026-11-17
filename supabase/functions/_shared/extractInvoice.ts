// extractInvoice — reads a photographed supplier invoice into structured data.
//
// The one place that knows which model reads invoices and how it is asked. The
// Edge Function hands it page images and gets back the extraction, the model's
// name and what it cost; nothing else in the app names a provider, so changing
// model or provider is a change to this file and an env var.
//
// What it is told, and why:
//   - The pages are ONE invoice, in order. Items continue across pages.
//   - Items only. Subtotal, discount, VAT, rounding and total rows are fields of
//     their own, never items — a "סה״כ" row read as an item doubles the expense.
//   - null when unsure. A guessed figure looks exactly like a read one on the
//     review screen; a blank one is highlighted and gets checked.
//   - Figures as printed. Whether prices include VAT is reported, not undone
//     here: the conversion is the app's (finalNet/spreadToNet in
//     @garage/shared), the same arithmetic as everywhere else in the system.
//
// It deliberately returns no per-field confidence. Models do not report their
// own certainty reliably, and the review screen highlights what fails a check
// (line arithmetic, the sum of lines against the totals, VAT, the tax-id check
// digit) — evidence, rather than a self-assessment.

import Anthropic from 'npm:@anthropic-ai/sdk@^1.8.0';

export interface ExtractedLine {
  desc: string | null;
  qty: number | null;
  unit_price: number | null;
  line_total: number | null;
}

export interface InvoiceExtraction {
  supplier_name: string | null;
  supplier_tax_id: string | null;
  /** "עוסק פטור" is printed on the document: it carries no VAT. */
  exempt_dealer: boolean;
  document_type: string | null;
  invoice_number: string | null;
  /** YYYY-MM-DD. */
  invoice_date: string | null;
  /** True when the item prices as printed already include VAT. */
  prices_include_vat: boolean | null;
  lines: ExtractedLine[];
  /** A discount on the whole document, before VAT, as a positive amount. */
  document_discount: number | null;
  /** Before VAT, after any document discount. */
  subtotal: number | null;
  vat_amount: number | null;
  total: number | null;
  /** Anything the reader could not make out, in a few words of Hebrew. */
  unreadable: string | null;
}

export interface ExtractionRun {
  extraction: InvoiceExtraction;
  model: string;
  inputTokens: number;
  outputTokens: number;
  ms: number;
}

/** A failure the person can act on: say it, offer to retry or type it in. */
export class ExtractionError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message);
  }
}

const num = { anyOf: [{ type: 'number' }, { type: 'null' }] };
const str = { anyOf: [{ type: 'string' }, { type: 'null' }] };

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'supplier_name', 'supplier_tax_id', 'exempt_dealer', 'document_type',
    'invoice_number', 'invoice_date', 'prices_include_vat', 'lines',
    'document_discount', 'subtotal', 'vat_amount', 'total', 'unreadable',
  ],
  properties: {
    supplier_name: str,
    supplier_tax_id: str,
    exempt_dealer: { type: 'boolean' },
    document_type: str,
    invoice_number: str,
    invoice_date: { anyOf: [{ type: 'string', format: 'date' }, { type: 'null' }] },
    prices_include_vat: { anyOf: [{ type: 'boolean' }, { type: 'null' }] },
    lines: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['desc', 'qty', 'unit_price', 'line_total'],
        properties: { desc: str, qty: num, unit_price: num, line_total: num },
      },
    },
    document_discount: num,
    subtotal: num,
    vat_amount: num,
    total: num,
    unreadable: str,
  },
};

const SYSTEM = `You read photographed Israeli supplier invoices for a car garage's bookkeeping.

The images and PDF files are the pages of ONE document, in order. The text is Hebrew, right to left; numbers are written left to right. Items may continue from one page to the next.

Return:
- supplier_name: the business that ISSUED the document (usually at the top), not the garage it was issued to.
- supplier_tax_id: the issuer's ח.פ. / ע.מ. / עוסק מורשה / עוסק פטור number, digits as printed.
- exempt_dealer: true only if the document says עוסק פטור.
- document_type: as printed, e.g. חשבונית מס, חשבונית מס קבלה, קבלה, תעודת משלוח.
- invoice_number, invoice_date (YYYY-MM-DD; Israeli dates are day/month/year).
- prices_include_vat: true if the item prices as printed already include VAT, false if VAT is added below them, null if you cannot tell.
- lines: the purchased items only, in document order. desc in the document's language; qty, unit_price and line_total as printed (unit_price is per unit). NEVER put subtotal, discount, VAT, rounding, deposit or total rows in lines.
- document_discount: a discount on the whole document as a positive amount, else null.
- subtotal (before VAT, after the document discount), vat_amount, total (the amount payable).
- unreadable: a few words in Hebrew on anything you could not make out, else null.

Use null for anything you cannot read with certainty. Never guess or compute a missing figure: a blank field gets checked by a person, a guessed one does not.`;

/** Long enough for a five-page invoice on a slow day; short enough that the
 *  person waiting on the processing screen is told something. The SDK does not
 *  retry — the screen's retry button does, and a scan that was extracted is
 *  served from the row rather than read twice. */
const TIMEOUT_MS = 50_000;

/** One file of the document: a page photographed (JPEG) or a PDF as the
 *  supplier sent it — the model reads a PDF's pages itself. */
export interface DocumentFile {
  bytes: Uint8Array;
  mediaType: 'image/jpeg' | 'application/pdf';
}

export async function extractInvoice(files: DocumentFile[]): Promise<ExtractionRun> {
  const model = Deno.env.get('EXTRACT_MODEL') || 'claude-haiku-5-5';
  const effort = (Deno.env.get('EXTRACT_EFFORT') || 'low') as 'low' | 'medium' | 'high';
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) throw new ExtractionError('invoice scanning is not configured on this server', false);
  const client = new Anthropic({ apiKey, timeout: TIMEOUT_MS, maxRetries: 0 });

  const content: Anthropic.ContentBlockParam[] = files.map((f): Anthropic.ContentBlockParam =>
    f.mediaType === 'application/pdf'
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: toBase64(f.bytes) } }
      : { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: toBase64(f.bytes) } });
  content.push({
    type: 'text',
    text: files.length === 1
      ? 'One file of one invoice. Extract the invoice.'
      : `${files.length} files of one invoice, in order. Extract it.`,
  });

  const started = Date.now();
  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      model,
      max_tokens: 8000,
      system: SYSTEM,
      messages: [{ role: 'user', content }],
      output_config: { effort, format: { type: 'json_schema', schema: SCHEMA } },
    });
  } catch (e) {
    if (e instanceof Anthropic.APIConnectionTimeoutError) {
      throw new ExtractionError('reading the invoice took too long', true);
    }
    if (e instanceof Anthropic.RateLimitError || e instanceof Anthropic.InternalServerError
        || e instanceof Anthropic.APIConnectionError) {
      throw new ExtractionError('the reading service is busy', true);
    }
    if (e instanceof Anthropic.APIError) {
      throw new ExtractionError(`the reading service refused the request (${e.status})`, false);
    }
    throw e;
  }
  const ms = Date.now() - started;

  if (response.stop_reason === 'refusal') {
    throw new ExtractionError('the document could not be read', false);
  }
  if (response.stop_reason === 'max_tokens') {
    throw new ExtractionError('the invoice is too long to read in one go', false);
  }
  const text = response.content.find((b) => b.type === 'text');
  if (!text || text.type !== 'text') {
    throw new ExtractionError('the reading came back empty', true);
  }
  let extraction: InvoiceExtraction;
  try {
    extraction = JSON.parse(text.text);
  } catch {
    throw new ExtractionError('the reading came back malformed', true);
  }

  return {
    extraction,
    model: response.model,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    ms,
  };
}

/** btoa over a byte string, in chunks — spreading a whole page into one
 *  fromCharCode call overflows the argument limit. */
function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}
