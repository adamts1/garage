/* The Pelecard adapter's reading of Pelecard's answers.
 *
 * The payloads below were captured from the sandbox (terminal 0882577012) on
 * 2026-11-19, trimmed to the fields that matter. Where they disagree with the
 * programmer's manual the sandbox is right — see the header of adapter.ts. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { agorot, attemptParamX, cardTypeOf, firstPaymentAgorot, pelecardAdapter, readCharge, reportTime, terminalBody, entryOf, guardAuth, initBody, paramX, readInit, readRefund, readTransaction, scrub } from './adapter.ts';
import { ProviderAuthError } from '../provider.ts';

const PAYMENT = '6b1f3c1e-2d4a-4c55-9b0e-0f3a3e7c9a11';

const approved = {
  StatusCode: '000',
  ErrorMessage: 'operation success',
  ResultData: {
    TransactionId: '4af9a67b-1bde-4e3e-9087-572eb46305e4',
    ShvaResult: '000',
    ShvaResultEmv: '000',
    ShvaResultEmvMessage: 'תקין',
    DebitApproveNumber: '5290198',
    ConfirmationKey: '188c216a64b6ebf5795076b5a117e88a',
    CreditCardNumber: '532610******0772',
    CardHebrewName: 'יורוקרד מסטרקרד',
    ShvaOutput: '0000000532610******077211000405310000000100',
    DebitTotal: '100',
    TotalPayments: '1',
    UserKey: PAYMENT,
  },
};

describe('init', () => {
  it('takes the transaction id from the URL — init has no TransactionId field', () => {
    const started = readInit({
      URL: 'https://gateway21.pelecard.biz/PaymentGW?transactionId=4af9a67b-1bde-4e3e-9087-572eb46305e4',
      ConfirmationKey: '188c216a64b6ebf5795076b5a117e88a',
      Error: { ErrCode: 0 },
    });
    expect(started.providerTxId).toBe('4af9a67b-1bde-4e3e-9087-572eb46305e4');
    expect(started.confirmationKey).toBe('188c216a64b6ebf5795076b5a117e88a');
  });

  it('reads the nested error', () => {
    expect(() => readInit({ Error: { ErrCode: 3, ErrMsg: 'bad terminal' } })).toThrow(/3.*bad terminal/);
  });

  it('sends agorot, a valid ParamX, and the terminal only with a shop number', () => {
    const creds = { terminal: 't', user: 'u', password: 'p' };
    const base = { credentials: {}, paymentId: PAYMENT, amount: 350.5, installments: 1, purpose: 'charge' as const, label: 'Ticket ABC-123', returnUrl: 'https://x/pay-return.html', posShopNo: null };
    const plain = initBody(creds, base);
    expect(plain.Total).toBe(35050);
    expect(plain.ParamX).toBe('ticketabc126b1f3c1e'); // 19: the ticket part gives way, the attempt code does not
    expect(plain.UserKey).toBe(PAYMENT);
    expect(plain.GoodURL).toBe('https://x/pay-return.html?r=good');
    expect(plain).not.toHaveProperty('EmvPinpad');
    expect(plain).toMatchObject({ MaxPayments: 1, MinPayments: 1 });
    expect(initBody(creds, { ...base, installments: 6 })).toMatchObject({ MaxPayments: 6, MinPayments: 6, MinPaymentsForCredit: 99 });
    expect(initBody(creds, { ...base, posShopNo: '7' })).toMatchObject({ EmvPinpad: 'True', ShopNo: '7' });
  });

  it('each attempt has its own ParamX: the ticket, then the attempt', () => {
    expect(attemptParamX('GAR-137', '9a04aca5-3339-42cb-949f-ed0f80b1104d')).toBe('gar1379a04aca5');
    const long = attemptParamX('GARAGE-1234567890123', '9a04aca5-3339-42cb-949f-ed0f80b1104d');
    expect(long).toHaveLength(19);
    expect(long.endsWith('9a04aca5')).toBe(true);
  });

  it('agorot round, ParamX caps at 19', () => {
    expect(agorot(0.1 + 0.2)).toBe(30);
    expect(paramX('A'.repeat(40))).toHaveLength(19);
  });
});

describe('GetTransaction', () => {
  const expected = { paymentId: PAYMENT, amount: 1, installments: 1 };

  it('an approved card with the right amount and our key is paid (pending validation)', () => {
    const v = readTransaction(approved, expected);
    expect(v).toMatchObject({ status: 'paid', amount: 1, installments: 1, approvalNumber: '5290198', cardLast4: '0772', cardBrand: 'יורוקרד מסטרקרד', cardType: 'mastercard' });
  });

  it('names the brand from what the sandbox actually sent', () => {
    // Both came back with CardEnName "Isracard" — the issuer, not the brand.
    expect(cardTypeOf({ CardHebrewName: 'אמריקן אקספרס', CardEnName: 'Isracard', CreditCardBrand: '4' })).toBe('amex');
    expect(cardTypeOf({ CardHebrewName: 'יורוקרד מסטרקרד', CardEnName: 'Isracard', CreditCardBrand: '1' })).toBe('mastercard');
    expect(cardTypeOf({ CardHebrewName: '', CreditCardBrand: '9' })).toBeNull();
  });

  it('an untouched page — 510 with empty strings — is pending, silently', () => {
    const v = readTransaction({
      StatusCode: '510',
      ErrorMessage: 'Request Data Not Found',
      ResultData: { ShvaResult: '', DebitTotal: '', UserKey: '' },
    }, expected);
    expect(v).toEqual(expect.objectContaining({ status: 'pending', message: null }));
  });

  it('a refused card is declined even though the envelope is not 000', () => {
    const v = readTransaction({
      StatusCode: '004',
      ErrorMessage: 'operation success',
      ResultData: { ShvaResult: '004', ShvaResultEmvMessage: 'סירוב', DebitTotal: '100' },
    }, expected);
    expect(v).toEqual(expect.objectContaining({ status: 'declined', message: 'סירוב' }));
  });

  it('never shows the envelope message on a decline', () => {
    const v = readTransaction({ StatusCode: '004', ErrorMessage: 'operation success', ResultData: { ShvaResult: '004' } }, expected);
    expect(v.status === 'declined' && v.message).toBe('העסקה סורבה על ידי חברת האשראי');
  });

  it('a different amount is never paid — it stays pending', () => {
    expect(readTransaction(approved, { paymentId: PAYMENT, amount: 2, installments: 1 }).status).toBe('pending');
  });

  it('a different number of installments is never paid', () => {
    expect(readTransaction(approved, { paymentId: PAYMENT, amount: 1, installments: 3 }).status).toBe('pending');
    const inThree = { ...approved, ResultData: { ...approved.ResultData, TotalPayments: '3' } };
    expect(readTransaction(inThree, { paymentId: PAYMENT, amount: 1, installments: 3 })).toMatchObject({ status: 'paid', installments: 3 });
  });

  it('a transaction carrying another payment id is never paid', () => {
    expect(readTransaction(approved, { paymentId: 'someone-else', amount: 1, installments: 1 }).status).toBe('pending');
  });

  it('keeps no card number in what it stores', () => {
    const r = (scrub(approved) as { ResultData: Record<string, string> }).ResultData;
    expect(r.CreditCardNumber).toBe('[removed]');
    expect(r.ShvaOutput).toBe('[removed]');
    expect(JSON.stringify(scrub(approved))).not.toContain('532610');
  });
});

/* Captured from the sandbox on 2026-11-20 against the transactions above. */
describe('refund (ReverseTransaction)', () => {
  it('a refund that went through names its own transaction', () => {
    expect(readRefund({ StatusCode: '000', ErrorMessage: 'operation success', ResultData: { ShvaResult: '000', PelecardTransactionId: '3204685055', DebitTotal: '8441', DebitApproveNumber: '5297828' } }))
      .toEqual({ ok: true, id: '3204685055', approval: '5297828' });
  });

  it('a refused refund is a definite no', () => {
    const r = readRefund({ StatusCode: '173', ErrorMessage: 'double transaction.' });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.message).toMatch(/עסקה כפולה.*\(173\)$/);
  });

  it('keeps no card number from a refund answer either (it spells it shvaOutput)', () => {
    const s = JSON.stringify(scrub({ ResultData: { shvaOutput: '0000000531084******9154110004' } }));
    expect(s).not.toContain('531084');
  });

  it('the verified charge carries the id a refund needs', () => {
    const v = readTransaction({ ...approved, ResultData: { ...approved.ResultData, TransactionPelecardId: '3200755632' } }, { paymentId: PAYMENT, amount: 1, installments: 1 });
    expect(v).toMatchObject({ status: 'paid', providerRef: '3200755632' });
  });
});

describe('the breaker', () => {
  it('every credential answer, from any call, is a ProviderAuthError', () => {
    for (const c of ['404', '501', '502', '503', '505', '507', '509', 501]) expect(() => guardAuth(c)).toThrow(ProviderAuthError);
    expect(() => readInit({ Error: { ErrCode: 501, ErrMsg: 'User name and/or password not correct' } })).toThrow(ProviderAuthError);
    expect(() => readTransaction({ StatusCode: '503' }, { paymentId: PAYMENT, amount: 1, installments: 1 })).toThrow(ProviderAuthError);
    expect(() => readRefund({ StatusCode: '507' })).toThrow(ProviderAuthError);
  });

  it('nothing else trips it', () => {
    for (const c of ['000', '004', '510', '519', '173', '', undefined]) expect(() => guardAuth(c)).not.toThrow();
  });
});

describe('the terminal', () => {
  it('a check is J2 — nothing charged — and only that is sent to the terminal', () => {
    const creds = { terminal: 't', user: 'u', password: 'p' };
    const check = initBody(creds, { credentials: {}, paymentId: PAYMENT, amount: 1, installments: 1, purpose: 'check', label: 'terminal check', returnUrl: 'https://x/r', posShopNo: '7' });
    expect(check).toMatchObject({ ActionType: 'J2', EmvPinpad: 'True', ShopNo: '7' });
  });

  it('a check succeeds on the card answering, with no amount to match', () => {
    const v = readTransaction({ StatusCode: '000', ResultData: { ShvaResult: '000', DebitTotal: '0' } }, { paymentId: PAYMENT, amount: 1, installments: 1, purpose: 'check' });
    expect(v.status).toBe('paid');
  });

  it('a typed card is "page"; a chip read is "terminal"', () => {
    expect(entryOf(approved.ResultData as never)).toBe('page');
    expect(entryOf({ Aid: 'A0000000041010', CardSeqNumber: '01' })).toBe('terminal');
  });
});

describe('refund call', () => {
  afterEach(() => vi.unstubAllGlobals());
  const input = {
    credentials: { terminal: '0882577012', user: 'u', password: 'p' },
    paymentId: PAYMENT, providerRef: '3202622442', providerUid: '26112009500908825771156',
    chargedAmount: 159.3, amount: 50, whole: false, entry: null,
  };

  it('is one ReverseTransaction, by both ids, in agorot', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({
      StatusCode: '000', ResultData: { ShvaResult: '000', PelecardTransactionId: '3205461248', DebitApproveNumber: '5299678', DebitTotal: '5000' },
    })));
    vi.stubGlobal('fetch', fetch);
    const r = await pelecardAdapter.refund(input);
    expect(r).toMatchObject({ status: 'refunded', providerRefundId: '3205461248', approvalNumber: '5299678' });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, { body: string }];
    expect(url).toMatch(/\/services\/ReverseTransaction$/);
    expect(JSON.parse(init.body)).toMatchObject({ uid: '26112009500908825771156', debittrxid: '3202622442', newamount: '5000' });
  });

  it('no Uid: refused before anything is sent', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    expect((await pelecardAdapter.refund({ ...input, providerUid: null })).status).toBe('failed');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('no answer is "unknown", never "failed"', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('timeout'); }));
    expect((await pelecardAdapter.refund(input)).status).toBe('unknown');
  });

  it('a rejected login trips the breaker', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ StatusCode: '501' }))));
    await expect(pelecardAdapter.refund(input)).rejects.toBeInstanceOf(ProviderAuthError);
  });
});

describe('straight to the terminal', () => {
  afterEach(() => vi.unstubAllGlobals());
  const creds = { terminal: 't', user: 'u', password: 'p' };
  const charge = { credentials: creds, paymentId: '9a04aca5-3339-42cb-949f-ed0f80b1104d', amount: 130.98, installments: 1, label: 'GAR-137', posShopNo: '001' };

  it('one payment: DebitRegularType to the shop number, no card', () => {
    const { method, body } = terminalBody(creds, charge);
    expect(method).toBe('DebitRegularType');
    expect(body).toMatchObject({ shopNumber: '001', total: '13098', currency: '1', paramX: 'gar1379a04aca5' });
    // Every card field present and empty, as in Pelecard's example request.
    for (const k of ['creditCard', 'creditCardDateMmYy', 'token', 'cvv2', 'id', 'authorizationNumber', 'QAResultStatus', 'eci', 'xid', 'cavv']) {
      expect(body[k]).toBe('');
    }
    expect(body).not.toHaveProperty('paymentsNumber');
  });

  it('installments: DebitPaymentsType, the remainder on the first payment', () => {
    const { method, body } = terminalBody(creds, { ...charge, installments: 7 });
    expect(method).toBe('DebitPaymentsType');
    expect(body).toMatchObject({ paymentsNumber: '7', firstPayment: '1872' }); // 18.72 + 6 × 18.71, as Pelecard split it
    expect(firstPaymentAgorot(118, 6)).toBe(1970);
  });

  const approval = { ShvaResult: '000', DebitTotal: '13098', TotalPayments: '1', DebitApproveNumber: '5299678', PelecardTransactionId: '3206470029', Uid: '26112...', CardHebName: 'יורוקרד מסטרקרד', PanEntryMode: '05' };

  it('an approval for the amount is paid, read off the terminal', () => {
    expect(readCharge(approval, { amount: 130.98, installments: 1 }, null))
      .toMatchObject({ status: 'paid', approvalNumber: '5299678', providerRef: '3206470029', cardBrand: 'יורוקרד מסטרקרד', entry: 'terminal' });
  });

  it('a refusal is declined — the sandbox\'s own answer with no device behind the shop', () => {
    const v = readCharge({ ShvaResult: '508', ShvaResultEmvMessage: 'תאריך תוקף לא במבנה תקין ,Pan,expirationDate' }, { amount: 1, installments: 1 }, null);
    expect(v.status).toBe('declined');
    expect(readCharge({ ShvaResult: '009' }, { amount: 1, installments: 1 }, null)).toMatchObject({ status: 'declined', message: expect.stringContaining('אין תקשורת עם המסוף') });
  });

  it('a wrong amount or plan is never paid', () => {
    expect(readCharge(approval, { amount: 131, installments: 1 }, null).status).toBe('pending');
    expect(readCharge(approval, { amount: 130.98, installments: 3 }, null).status).toBe('pending');
  });

  it('the report writes the result as "0" — still an approval', () => {
    expect(readCharge({ ...approval, ShvaResult: '0' }, { amount: 130.98, installments: 1 }, null).status).toBe('paid');
  });

  it('the report window is Israel time, as dd/MM/yyyy HH:mm', () => {
    expect(reportTime(new Date('2026-11-20T07:50:00Z'))).toBe('20/11/2026 09:50');
  });

  it('a minute without a card: 075, a definite no — declined, try again', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ StatusCode: '075', ErrorMessage: 'timeout' }))));
    expect(await pelecardAdapter.chargeOnTerminal!(charge)).toMatchObject({ status: 'declined', message: expect.stringContaining('תוך דקה') });
  });

  it('no answer from the terminal call is pending, never declined', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('timeout'); }));
    expect((await pelecardAdapter.chargeOnTerminal!(charge)).status).toBe('pending');
  });

  it('a lost answer is found by its own ParamX in the report', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ StatusCode: '000', ResultData: [
      { ...approval, ShvaResult: '0', AdditionalDetailsParamX: 'gar137ffffffff' },
      { ...approval, ShvaResult: '0', AdditionalDetailsParamX: 'gar1379a04aca5', DebitApproveNumber: '7777777' },
    ] })));
    vi.stubGlobal('fetch', fetch);
    const v = await pelecardAdapter.findAttempt!({ ...charge, at: '2026-11-20T07:50:00Z' });
    expect(v).toMatchObject({ status: 'paid', approvalNumber: '7777777' });
    const [url] = fetch.mock.calls[0] as unknown as [string];
    expect(url).toMatch(/\/services\/GetCompleteTransData$/);
  });

  it('not in the report yet: pending', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ StatusCode: '000', ResultData: [] }))));
    expect((await pelecardAdapter.findAttempt!({ ...charge, at: '2026-11-20T07:50:00Z' })).status).toBe('pending');
  });
});
