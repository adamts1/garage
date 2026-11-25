/* The onboarding form as the person fills it in — strings for numbers, a mode
   for card clearing — and its conversion to what the server takes. Pure, and
   tested: the conversion is where "18" becomes 0.18. */

import type {
  BookkeepingSoftware,
  EnvId,
  InvoiceDocType,
  Letterhead,
  OnboardingInput,
} from '../../api/types';

/** none: no card settings at all. installments: limits for a card taken on the
 *  garage's own terminal and recorded by hand. pelecard: connected clearing. */
export type PaymentsMode = 'none' | 'installments' | 'pelecard';

export interface OnboardingForm {
  env: EnvId;
  confirmEnv: string;

  name: string;
  letterhead: Record<keyof Letterhead, string>;
  seedCatalog: boolean;

  email: string;
  password: string;

  invoicingOn: boolean;
  cid: string;
  token: string;
  vatPercent: string;
  docType: InvoiceDocType;
  invoicingActive: boolean;

  software: BookkeepingSoftware | '';
  accountantEmail: string;

  paymentsMode: PaymentsMode;
  terminal: string;
  terminalUser: string;
  terminalPassword: string;
  shopNo: string;
  maxInstallments: string;
  installmentsMin: string;
  paymentsActive: boolean;
  allowTestTerminal: boolean;
  realTerminal: boolean;
}

export const emptyLetterhead = (): Record<keyof Letterhead, string> => ({
  printName: '', motto: '', services: '', address: '', phone: '', fax: '', licenseNo: '', taxId: '',
});

export const emptyForm = (env: EnvId = 'staging'): OnboardingForm => ({
  env,
  confirmEnv: '',
  name: '',
  letterhead: emptyLetterhead(),
  seedCatalog: false,
  email: '',
  password: '',
  invoicingOn: false,
  cid: '',
  token: '',
  vatPercent: '18',
  docType: 'invoice_receipt',
  invoicingActive: true,
  software: '',
  accountantEmail: '',
  paymentsMode: 'none',
  terminal: '',
  terminalUser: '',
  terminalPassword: '',
  shopNo: '',
  maxInstallments: '12',
  installmentsMin: '0',
  paymentsActive: false,
  allowTestTerminal: false,
  realTerminal: false,
});

/** A number the person typed; blank or junk is NaN, which validation refuses. */
const num = (s: string): number => (s.trim() === '' ? Number.NaN : Number(s));

export function toInput(form: OnboardingForm): OnboardingInput {
  /* A new garage has no letterhead to keep, so a blank field is simply not
     sent rather than sent as "clear it". */
  const letterhead: Partial<Letterhead> = {};
  for (const [k, v] of Object.entries(form.letterhead) as [keyof Letterhead, string][]) {
    if (v.trim()) letterhead[k] = v.trim();
  }

  /* Bookkeeping is part of the invoicing section; switching invoicing off
     drops it even if fields were filled before. */
  const bookkeepingGiven = form.invoicingOn && Boolean(form.software || form.accountantEmail.trim());

  return {
    env: form.env,
    confirmEnv: form.confirmEnv,
    garage: { name: form.name.trim(), letterhead, seedCatalog: form.seedCatalog },
    admin: { email: form.email.trim(), password: form.password },
    invoicing: form.invoicingOn
      ? {
          provider: 'icount',
          cid: form.cid.trim(),
          token: form.token.trim(),
          vatRate: Math.round(num(form.vatPercent) * 100) / 10000,
          docType: form.docType,
          active: form.invoicingActive,
        }
      : null,
    bookkeeping: bookkeepingGiven
      ? { software: form.software || null, accountantEmail: form.accountantEmail.trim() }
      : null,
    payments: form.paymentsMode === 'none'
      ? null
      : {
          credentials: form.paymentsMode === 'pelecard'
            ? { terminal: form.terminal.trim(), user: form.terminalUser.trim(), password: form.terminalPassword }
            : null,
          shopNo: form.paymentsMode === 'pelecard' ? form.shopNo.trim() : '',
          maxInstallments: num(form.maxInstallments),
          installmentsMin: num(form.installmentsMin),
          active: form.paymentsMode === 'pelecard' && form.paymentsActive,
          allowTestTerminal: form.allowTestTerminal,
          realTerminal: form.realTerminal,
        },
  };
}
