/* The Pelecard adapter's reading of Pelecard's answers.
 *
 * The payloads below were captured from the sandbox (terminal 0882577012) on
 * 2026-11-19, trimmed to the fields that matter. Where they disagree with the
 * programmer's manual the sandbox is right — see the header of adapter.ts. */
import { describe, expect, it } from 'vitest';
import { agorot, cardTypeOf, initBody, paramX, readInit, readTransaction, scrub } from './adapter.ts';

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
    const base = { credentials: {}, paymentId: PAYMENT, amount: 350.5, installments: 1, label: 'Ticket ABC-123', returnUrl: 'https://x/pay-return.html', posShopNo: null };
    const plain = initBody(creds, base);
    expect(plain.Total).toBe(35050);
    expect(plain.ParamX).toBe('ticketabc123');
    expect(plain.UserKey).toBe(PAYMENT);
    expect(plain.GoodURL).toBe('https://x/pay-return.html?r=good');
    expect(plain).not.toHaveProperty('EmvPinpad');
    expect(plain).toMatchObject({ MaxPayments: 1, MinPayments: 1 });
    expect(initBody(creds, { ...base, installments: 6 })).toMatchObject({ MaxPayments: 6, MinPayments: 6, MinPaymentsForCredit: 99 });
    expect(initBody(creds, { ...base, posShopNo: '7' })).toMatchObject({ EmvPinpad: 'True', ShopNo: '7' });
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
