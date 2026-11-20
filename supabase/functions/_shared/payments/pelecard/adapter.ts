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

import type {
  CardType, PaymentCredentials, PaymentProvider, StartInput, StartedPayment, Verdict, VerifyInput,
} from '../provider.ts';

// deno-lint-ignore no-explicit-any
const env = (k: string): string | undefined => (globalThis as any).Deno?.env.get(k);

/* Overridable only so a local test can point it at a stand-in. Sandbox and
   production are the same host; a test terminal is what makes a sandbox. */
const BASE = () => env('PELECARD_BASE_URL') ?? 'https://gateway21.pelecard.biz/PaymentGW';

/* Well inside the function's own wall clock, so a slow Pelecard turns into a
   'pending' we can record rather than the platform killing us mid-call. */
const TIMEOUT_MS = 20_000;

interface Creds { terminal: string; user: string; password: string }

function readCreds(c: PaymentCredentials): Creds {
  const terminal = String(c.terminal ?? '').trim();
  const user = String(c.user ?? '').trim();
  const password = String(c.password ?? '');
  if (!terminal || !user || !password) throw new Error('Pelecard credentials must include terminal, user and password');
  return { terminal, user, password };
}

export const agorot = (shekels: number) => Math.round(shekels * 100);

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
    ActionType: 'J4',
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

/* Used only when the bank sent no sentence of its own. */
const DECLINES: Record<string, string> = {
  '004': 'העסקה סורבה על ידי חברת האשראי',
  '555': 'הלקוח ביטל את התשלום',
};

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
    for (const k of ['CreditCardNumber', 'Token', 'ShvaOutput', 'CardHolderID']) if (k in r) r[k] = r[k] ? '[removed]' : '';
  }
  return d;
}

/** Turns GetTransaction's answer into a provisional verdict. 'paid' here still
 *  needs ValidateByUniqueKey before it is believed — see verify(). */
export function readTransaction(
  data: unknown,
  expected: { paymentId: string; amount: number; installments: number },
): Verdict {
  // deno-lint-ignore no-explicit-any
  const d = data as any;
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
    raw,
  };
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

    const verdict = readTransaction(tx, { paymentId: input.paymentId, amount: input.amount, installments: input.installments });
    if (verdict.status !== 'paid') return verdict;

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
};
