/* The rules an onboarding must meet, as pure functions.
 *
 * Imported by the console's page (to show errors as you type) and by the
 * server (which re-checks everything — the page is a convenience, never the
 * guard). So: no Node, no Supabase, no imports but types.
 *
 * Errors are codes, not text. The page turns a code into a sentence through its
 * locale file; the server sends the codes back unchanged.
 */

import type { EnvId, Letterhead, OnboardingInput, ValidationErrors } from '../types.ts';

/** Pelecard's public test terminal: approves cards, moves no money. */
export const PELECARD_TEST_TERMINAL = '0882577012';

export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export const LETTERHEAD_FIELDS = [
  'printName', 'motto', 'services', 'address', 'phone', 'fax', 'licenseNo', 'taxId',
] as const satisfies readonly (keyof Letterhead)[];

/** Letterhead field → its column on `garages`. */
export const LETTERHEAD_COLUMNS: Record<keyof Letterhead, string> = {
  printName: 'print_name',
  motto: 'motto',
  services: 'services',
  address: 'address',
  phone: 'phone',
  fax: 'fax',
  licenseNo: 'license_no',
  taxId: 'tax_id',
};

/** The letterhead as columns. Only fields that were given; an empty string
 *  clears a field (null), an absent one is left alone — so correcting a phone
 *  number never blanks the address. */
export function letterheadColumns(letterhead: Partial<Letterhead>): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const field of LETTERHEAD_FIELDS) {
    const v = letterhead[field];
    if (v !== undefined) out[LETTERHEAD_COLUMNS[field]] = v === null ? null : v.trim() || null;
  }
  return out;
}

export const normalizeEmail = (email: string): string => email.trim().toLowerCase();

export type ErrorCode =
  | 'required'
  | 'email'
  | 'confirmEnv'
  | 'vatRate'
  | 'maxInstallments'
  | 'installmentsMin'
  | 'testTerminalOnProduction'
  | 'realTerminalNotConfirmed'
  | 'passwordTooShort'
  | 'needsInvoicing'
  | 'activeNeedsProvider';

const set = (errors: ValidationErrors, path: string, code: ErrorCode) => {
  if (!errors[path]) errors[path] = code;
};

/** Pelecard terminal rules, the same as connect-payments.mjs: the test terminal
 *  is refused on production (it would mark unpaid jobs paid), and a real one
 *  anywhere else needs saying out loud. */
export function terminalProblem(
  env: EnvId,
  terminal: string,
  { allowTestTerminal, realTerminal }: { allowTestTerminal: boolean; realTerminal: boolean },
): ErrorCode | null {
  const isTest = terminal.trim() === PELECARD_TEST_TERMINAL;
  if (env === 'production' && isTest && !allowTestTerminal) return 'testTerminalOnProduction';
  if (env !== 'production' && !isTest && !realTerminal) return 'realTerminalNotConfirmed';
  return null;
}

/** Everything wrong with an onboarding, by field path. Empty means valid. */
export function validateOnboarding(input: OnboardingInput): ValidationErrors {
  const errors: ValidationErrors = {};

  if (input.confirmEnv.trim() !== input.env) set(errors, 'confirmEnv', 'confirmEnv');

  if (!input.garage.name.trim()) set(errors, 'garage.name', 'required');

  if (!input.admin.email.trim()) set(errors, 'admin.email', 'required');
  else if (!EMAIL_RE.test(normalizeEmail(input.admin.email))) set(errors, 'admin.email', 'email');
  /* Supabase's own minimum. Empty is fine: one is generated. */
  if (input.admin.password && input.admin.password.length < 6) set(errors, 'admin.password', 'passwordTooShort');

  const inv = input.invoicing;
  if (inv) {
    if (!inv.cid.trim()) set(errors, 'invoicing.cid', 'required');
    if (!inv.token.trim()) set(errors, 'invoicing.token', 'required');
    if (!(inv.vatRate >= 0 && inv.vatRate < 1)) set(errors, 'invoicing.vatRate', 'vatRate');
  }

  const bk = input.bookkeeping;
  if (bk) {
    /* The settings live on garage_billing, which exists only once the garage
       is connected to its invoicing provider. */
    if (!inv) set(errors, 'bookkeeping.software', 'needsInvoicing');
    if (bk.accountantEmail.trim() && !EMAIL_RE.test(bk.accountantEmail.trim())) {
      set(errors, 'bookkeeping.accountantEmail', 'email');
    }
  }

  const pay = input.payments;
  if (pay) {
    if (!(Number.isInteger(pay.maxInstallments) && pay.maxInstallments >= 1 && pay.maxInstallments <= 36)) {
      set(errors, 'payments.maxInstallments', 'maxInstallments');
    }
    if (!(pay.installmentsMin >= 0)) set(errors, 'payments.installmentsMin', 'installmentsMin');
    const c = pay.credentials;
    if (!c && pay.active) set(errors, 'payments.active', 'activeNeedsProvider');
    if (c) {
      if (!c.terminal.trim()) set(errors, 'payments.terminal', 'required');
      if (!c.user.trim()) set(errors, 'payments.user', 'required');
      if (!c.password) set(errors, 'payments.password', 'required');
      const problem = c.terminal.trim() ? terminalProblem(input.env, c.terminal, pay) : null;
      if (problem) set(errors, 'payments.terminal', problem);
    }
  }

  return errors;
}
