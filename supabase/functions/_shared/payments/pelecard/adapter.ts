// Pelecard — one PaymentProvider adapter, iframe/redirect flow.
//
// Everything below was checked against Pelecard's sandbox (2026-07-30 and again
// 2026-11-19), and where it disagrees with the programmer's manual the sandbox
// wins. The regression tests in adapter.test.ts hold captured answers; do not
// "fix" the parsing back toward the documentation:
//
//   1. init returns no TransactionId field — the id is the `transactionId`
//      query parameter of the returned URL — and its error is nested:
//      {"Error":{"ErrCode":0}} on success.
//   2. A hosted page can be used ONCE (reopened: error 0004) and EXPIRES within
//      minutes (error 0003). So it is opened when somebody presses pay, never
//      ahead of time, and a retry is a new init.
//   3. GetTransaction's StatusCode mirrors the TRANSACTION, not the lookup: a
//      refused card is StatusCode "004" with a full ResultData.
//   4. A transaction nobody has finished yet answers "510 Request Data Not
//      Found" with a ResultData full of empty strings. The only honest signal
//      that a verdict exists is a non-empty ResultData.ShvaResult.
//
// The envelope's ErrorMessage describes the API call, not the card — a decline
// reads "operation success" — so it is never shown. ShvaResultEmvMessage is
// the bank's Hebrew sentence and is what the advisor sees.
//
// Amounts are agorot. Currency "1" is ILS. ActionType "J4" is an ordinary debit.

import { ProviderAuthError } from '../provider.ts';
import type {
  CardEntry, CardType, PaymentCredentials, PaymentProvider, RefundInput, RefundResult, StartInput, StartedPayment, Verdict,
  VerifyInput,
} from '../provider.ts';

// deno-lint-ignore no-explicit-any
const env = (k: string): string | undefined => (globalThis as any).Deno?.env.get(k);

/* Overridable only so a local test can point it at a stand-in. Sandbox and
   production are the same host; a test terminal is what makes a sandbox. */
const BASE = () => env('PELECARD_BASE_URL') ?? 'https://gateway21.pelecard.biz/PaymentGW';
/* The server-to-server services (cancel, refund). Same host, another path,
   and its own spelling of the credentials: terminalNumber, not terminal. */
const SERVICES = () => env('PELECARD_SERVICES_URL') ?? 'https://gateway21.pelecard.biz/services';

/* Well inside the function's own wall clock, so a slow Pelecard turns into a
   'pending' we can record rather than the platform killing us mid-call. */
const TIMEOUT_MS = 20_000;

/* Cancel and refund are slower: the sandbox took 54 s to answer a refund on
   2026-11-22. Giving up early does not undo the refund — it only turns a clear
   answer into 'unknown', which then needs a person — so these wait longer,
   still inside the function's own wall clock. */
const SERVICE_TIMEOUT_MS = 100_000;

interface Creds { terminal: string; user: string; password: string }

function readCreds(c: PaymentCredentials): Creds {
  const terminal = String(c.terminal ?? '').trim();
  const user = String(c.user ?? '').trim();
  const password = String(c.password ?? '');
  if (!terminal || !user || !password) throw new Error('Pelecard credentials must include terminal, user and password');
  return { terminal, user, password };
}

export const agorot = (shekels: number) => Math.round(shekels * 100);

/* The answers that mean "these credentials will not do" (manual, Appendix B):
   404 no such terminal, 501 wrong user or password, 502 password expired,
   503 user locked, 505 terminal blocked, 507 user not allowed on the terminal,
   509 access blocked. Any of them, from any call, stops everything — see
   ProviderAuthError. */
export const AUTH_CODES = new Set(['404', '501', '502', '503', '505', '507', '509']);

const AUTH_MESSAGES: Record<string, string> = {
  '404': 'מספר המסוף לא קיים אצל פלאקארד',
  '501': 'שם המשתמש או הסיסמה של פלאקארד שגויים',
  '502': 'הסיסמה של פלאקארד פגה',
  '503': 'המשתמש נעול אצל פלאקארד',
  '505': 'המסוף חסום אצל פלאקארד',
  '507': 'המשתמש לא מורשה במסוף הזה',
  '509': 'הגישה נחסמה אצל פלאקארד',
};

/** Throws ProviderAuthError when `code` is one of the credential answers. */
export function guardAuth(code: unknown): void {
  const c = String(code ?? '').trim().padStart(3, '0');
  if (AUTH_CODES.has(c)) throw new ProviderAuthError(c, `${AUTH_MESSAGES[c]} (${c})`);
}

/* ParamX shows up in Pelecard's reports beside the transaction. Their limit is
   19 characters of lowercase letters and digits; anything else is refused. */
export const paramX = (label: string) => label.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 19);

// ---------------------------------------------------------------- start

export function initBody(c: Creds, input: StartInput): Record<string, unknown> {
  const back = (r: string) => `${input.returnUrl}${input.returnUrl.includes('?') ? '&' : '?'}r=${r}`;
  return {
    terminal: c.terminal,
    user: c.user,
    password: c.password,
    GoodURL: back('good'),
    ErrorURL: back('error'),
    CancelURL: back('cancel'),
    FeedbackDataTransferMethod: 'GET',
    /* J2 checks the card and charges nothing — the terminal check. */
    ActionType: input.purpose === 'check' ? 'J2' : 'J4',
    Currency: '1',
    Total: agorot(input.amount),
    UserKey: input.paymentId,
    ParamX: paramX(input.label),
    Language: 'HE',
    /* Exactly the number chosen in our drawer: min = max leaves the page
       nothing to choose. Credit (interest) plans start above anything we
       allow, so every plan is regular installments. */
    MaxPayments: input.installments,
    MinPayments: input.installments,
    MinPaymentsForCredit: 99,
    /* The button that hands the charge to the garage's card terminal. Only with
       a shop number to send it to; see StartInput.posShopNo. */
    ...(input.posShopNo ? { EmvPinpad: 'True', ShopNo: input.posShopNo } : {}),
  };
}

/** Reads init's answer. Throws when there is no page to open. */
export function readInit(data: unknown): StartedPayment {
  // deno-lint-ignore no-explicit-any
  const d = data as any;
  const code = d?.Error?.ErrCode;
  if (code !== 0 && code !== '0') {
    guardAuth(code);
    const msg = d?.Error?.ErrMsg ?? d?.ErrorMessage ?? 'unrecognised reply';
    throw new Error(`Pelecard init failed (${code ?? '?'}): ${msg}`);
  }
  const url = String(d?.URL ?? '');
  let providerTxId = '';
  try {
    providerTxId = new URL(url).searchParams.get('transactionId') ?? '';
  } catch { /* handled below */ }
  if (!providerTxId) throw new Error('Pelecard init returned no transaction id');
  return { url, providerTxId, confirmationKey: d?.ConfirmationKey ? String(d.ConfirmationKey) : null };
}

// ---------------------------------------------------------------- verify

/* Used only when the bank sent no sentence of its own. The terminal ones are
   the manual's (Appendix B); none has been seen from the N6 yet. */
const DECLINES: Record<string, string> = {
  '004': 'העסקה סורבה על ידי חברת האשראי',
  '555': 'הלקוח ביטל את התשלום',
  '009': 'אין תקשורת עם המסוף. בדוק שהוא דלוק ומחובר, ונסה שוב',
  '010': 'הפעולה בוטלה במסוף',
  '070': 'המסוף לא מוגדר אצל פלאקארד',
  '075': 'המסוף לא קיבל כרטיס בזמן',
  '500': 'המסוף באמצע שידור או עדכון. נסה שוב בעוד כמה דקות',
  '600': 'שגיאה במסוף. פנה לתמיכה של פלאקארד',
};

/* Was the card read by the terminal? A chip read carries the EMV application
   id (Aid) and a card sequence number; a card typed on the page has neither
   (seen on the sandbox, 2026-11-19). NOT yet seen on a terminal payment —
   check on the first one, and fix here if the N6 answers otherwise. */
export function entryOf(r: { Aid?: unknown; CardSeqNumber?: unknown } | null | undefined): CardEntry {
  return String(r?.Aid ?? '').trim() || String(r?.CardSeqNumber ?? '').trim() ? 'terminal' : 'page';
}

/* The brand, from the issuer's own Hebrew name first (it is what the bank
   says), then Pelecard's brand code. Code 4 was American Express on the
   sandbox (2026-11-20); 1 MasterCard and 2 Visa are Shva's. Anything else is
   left unknown rather than guessed — a receipt without a brand is fine, a
   receipt with the wrong one is not. */
export function cardTypeOf(r: { CardHebrewName?: unknown; CardEnName?: unknown; CreditCardBrand?: unknown } | null | undefined): CardType | null {
  const name = `${r?.CardHebrewName ?? ''} ${r?.CardEnName ?? ''}`.toLowerCase();
  if (/אמריקן|amex|american/.test(name)) return 'amex';
  if (/דיינרס|diners/.test(name)) return 'diners';
  if (/ויזה|visa/.test(name)) return 'visa';
  if (/מסטרקרד|מאסטרקרד|mastercard/.test(name)) return 'mastercard';
  const code = String(r?.CreditCardBrand ?? '').trim();
  if (code === '1') return 'mastercard';
  if (code === '2') return 'visa';
  if (code === '4') return 'amex';
  if (/ישראכרט/.test(name)) return 'isracard';
  return null;
}

const last4 = (masked: unknown) => {
  const digits = String(masked ?? '').replace(/\D/g, '');
  return digits.length >= 4 ? digits.slice(-4) : null;
};

/** Strips what must not be stored: the card number (already masked by
 *  Pelecard, but there is no reason to keep even that) and our credentials. */
export function scrub(data: unknown): unknown {
  // deno-lint-ignore no-explicit-any
  const d = JSON.parse(JSON.stringify(data ?? null)) as any;
  const r = d?.ResultData;
  if (r && typeof r === 'object') {
    /* By name, any case: the refund answers spell it shvaOutput, and it
       carries the masked card number. */
    for (const k of Object.keys(r)) {
      if (/^(creditcardnumber|token|shvaoutput|cardholderid)$/i.test(k)) r[k] = r[k] ? '[removed]' : '';
    }
  }
  return d;
}

/** Turns GetTransaction's answer into a provisional verdict. 'paid' here still
 *  needs ValidateByUniqueKey before it is believed — see verify(). */
export function readTransaction(
  data: unknown,
  expected: { paymentId: string; amount: number; installments: number; purpose?: 'charge' | 'check' },
): Verdict {
  // deno-lint-ignore no-explicit-any
  const d = data as any;
  guardAuth(d?.StatusCode);
  const r = d?.ResultData;
  const raw = scrub(data);
  const shva = String(r?.ShvaResult ?? '').trim();

  // Finding 4: no ShvaResult, no verdict — whatever the envelope says.
  if (!shva) {
    const status = String(d?.StatusCode ?? '');
    return {
      status: 'pending',
      // 510 just means the customer has not finished; not worth a message.
      message: status === '510' || status === '000' ? null : `Pelecard ${status}`,
      raw,
    };
  }

  if (shva !== '000') {
    const bank = String(r?.ShvaResultEmvMessage ?? '').trim();
    return {
      status: 'declined',
      message: bank && bank !== 'תקין' ? bank : DECLINES[shva] ?? `העסקה לא אושרה (קוד ${shva})`,
      raw,
    };
  }

  /* A check moves no money: the card answered, and that is all it asks. */
  if (expected.purpose === 'check') {
    return {
      status: 'paid', amount: 0, installments: 1,
      approvalNumber: String(r?.DebitApproveNumber ?? '').trim() || null,
      cardLast4: last4(r?.CreditCardNumber), cardBrand: String(r?.CardHebrewName ?? '').trim() || null,
      cardType: cardTypeOf(r), providerRef: String(r?.TransactionPelecardId ?? '').trim() || null,
      entry: entryOf(r), raw,
    };
  }

  const userKey = String(r?.UserKey ?? '').trim();
  if (userKey && userKey !== expected.paymentId) {
    return { status: 'pending', message: 'Pelecard transaction belongs to another payment', raw };
  }
  const debited = Number(r?.DebitTotal);
  if (debited !== agorot(expected.amount)) {
    return { status: 'pending', message: `amount mismatch: debited ${r?.DebitTotal} agorot`, raw };
  }
  const plan = Number(r?.TotalPayments) || 1;
  if (plan !== expected.installments) {
    return { status: 'pending', message: `installments mismatch: charged in ${r?.TotalPayments}`, raw };
  }
  return {
    status: 'paid',
    amount: debited / 100,
    installments: plan,
    approvalNumber: String(r?.DebitApproveNumber ?? '').trim() || null,
    cardLast4: last4(r?.CreditCardNumber),
    cardBrand: String(r?.CardHebrewName ?? '').trim() || null,
    cardType: cardTypeOf(r),
    providerRef: String(r?.TransactionPelecardId ?? '').trim() || null,
    entry: entryOf(r),
    raw,
  };
}

// ---------------------------------------------------------------- refund
//
// One operation for every return of money: ReverseTransaction. Pelecard's own
// advice (2026-11-22), for every status — before the nightly broadcast, after
// it, a charge typed on the page or taken on the terminal, whole or partial.
// It replaced CancelTransaction / RefundByID and their terminal (EMV) twins,
// and with them the guesswork about which one a charge needed.
//
// Checked on the sandbox, 2026-11-23, against charges already broadcast:
//   partial (50 of 159.30, 2 installments) → 000, a credit in 2 installments;
//   whole (118 in 4 installments)          → 000;
//   the same partial again                 → 173 "double transaction":
//     Pelecard refuses a second refund with identical values on one card.
// Pelecard does NOT cap refunds at the charge (it is up to the card company);
// the cap is ours, in issue-invoice.

// deno-lint-ignore no-explicit-any
const approvalOf = (r: any): string | null =>
  String(r?.DebitApproveNumber ?? r?.AuthManpikNo ?? '').trim() || null;

/* What the advisor is told when Pelecard says no — in Hebrew, for the ones
   that have happened. The code stays on the end for whoever calls Pelecard. */
const REFUND_REFUSALS: Record<string, string> = {
  '173': 'פלאקארד דחו החזר זהה להחזר קודם באותו יום (עסקה כפולה). אפשר להחזיר סכום אחר, או לנסות שוב מחר',
};

export function readRefund(data: unknown):
  { ok: true; id: string | null; approval: string | null } | { ok: false; message: string } {
  // deno-lint-ignore no-explicit-any
  const d = data as any;
  guardAuth(d?.StatusCode);
  const r = d?.ResultData;
  const code = String(d?.StatusCode ?? '');
  if (code === '000' && String(r?.ShvaResult ?? '') === '000') {
    return { ok: true, id: String(r?.PelecardTransactionId ?? '') || null, approval: approvalOf(r) };
  }
  const bank = String(r?.ShvaResultEmvMessage ?? '').trim();
  const said = REFUND_REFUSALS[code] ?? (bank && bank !== 'תקין' ? bank : d?.ErrorMessage || 'refund refused');
  return { ok: false, message: `${said} (${code || '?'})` };
}

// ---------------------------------------------------------------- transport

async function post(path: string, body: Record<string, unknown>): Promise<string> {
  const res = await fetch(`${BASE()}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Pelecard ${path}: HTTP ${res.status}`);
  return await res.text();
}

/** One services call. Null when no answer we can read came back — the call
 *  may have been acted on, so the caller reports 'unknown', never 'failed'. */
async function service(c: Creds, method: string, body: Record<string, unknown>): Promise<unknown | null> {
  try {
    const res = await fetch(`${SERVICES()}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ terminalNumber: c.terminal, user: c.user, password: c.password, ...body }),
      signal: AbortSignal.timeout(SERVICE_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return JSON.parse(await res.text());
  } catch {
    return null;
  }
}

export const pelecardAdapter: PaymentProvider = {
  async start(input) {
    const c = readCreds(input.credentials);
    return readInit(JSON.parse(await post('init', initBody(c, input))));
  },

  async verify(input: VerifyInput): Promise<Verdict> {
    const c = readCreds(input.credentials);
    let tx: unknown;
    try {
      tx = JSON.parse(await post('GetTransaction', {
        terminal: c.terminal, user: c.user, password: c.password, TransactionId: input.providerTxId,
      }));
    } catch (e) {
      return { status: 'pending', message: `lookup failed: ${(e as Error).message}`, raw: null };
    }

    const verdict = readTransaction(tx, {
      paymentId: input.paymentId, amount: input.amount, installments: input.installments, purpose: input.purpose,
    });
    if (verdict.status !== 'paid' || input.purpose === 'check') return verdict;

    /* The second, independent confirmation (manual §5): Pelecard answers "1"
       only if this key, this payment and this amount belong together. */
    if (!input.confirmationKey) return { status: 'pending', message: 'no confirmation key', raw: verdict.raw };
    let valid = '';
    try {
      valid = (await post('ValidateByUniqueKey', {
        ConfirmationKey: input.confirmationKey,
        UniqueKey: input.paymentId,
        TotalX100: String(agorot(input.amount)),
      })).trim().replace(/^"|"$/g, '');
    } catch (e) {
      return { status: 'pending', message: `validation failed: ${(e as Error).message}`, raw: verdict.raw };
    }
    if (valid !== '1') return { status: 'pending', message: 'Pelecard did not confirm the transaction', raw: verdict.raw };
    return verdict;
  },

  async refund(input: RefundInput): Promise<RefundResult> {
    const c = readCreds(input.credentials);
    if (!input.providerUid) {
      return { status: 'failed', message: 'the charge carries no Pelecard Uid to reverse', raw: null };
    }
    const answer = await service(c, 'ReverseTransaction', {
      uid: input.providerUid,
      debittrxid: input.providerRef,
      newamount: String(agorot(input.amount)),
      newparamx: paramX(`refund${input.paymentId}`),
    });
    if (answer == null) return { status: 'unknown', message: 'no answer from Pelecard to the refund', raw: null };
    const refund = readRefund(answer);
    const raw = scrub(answer);
    return refund.ok
      ? { status: 'refunded', kind: 'refund', providerRefundId: refund.id, approvalNumber: refund.approval, raw }
      : { status: 'failed', message: refund.message, raw };
  },
};

