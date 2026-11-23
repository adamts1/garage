/* Card clearing (Pelecard). The writes behind connect-payments.mjs and the
 * console's onboarding form.
 *
 *   * garage_payments        — provider, active, pos_shop_no, installments.
 *   * garage_payment_secrets — { terminal, user, password }. service_role only.
 *
 * Neither path calls Pelecard. A wrong password tried against Pelecard counts
 * toward locking the account — it happened to the pilot garage once — so the
 * first real call is a deliberate payment from the app, made once.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { EnvId } from '../types.ts';
import { terminalProblem } from './rules.ts';

export interface PaymentSettings {
  /** undefined: unchanged. null: remove the terminal (card entry only). */
  shopNo?: string | null;
  maxInstallments?: number;
  installmentsMin?: number;
}

export interface PaymentsSummary {
  provider: string;
  active: boolean;
  shopNo: string | null;
  maxInstallments: number;
  installmentsMin: number;
  suspended: boolean;
}

const settingsColumns = (s: PaymentSettings): Record<string, unknown> => {
  const row: Record<string, unknown> = {};
  if (s.shopNo !== undefined) row.pos_shop_no = s.shopNo?.trim() || null;
  if (s.maxInstallments !== undefined) row.max_installments = s.maxInstallments;
  if (s.installmentsMin !== undefined) row.installments_min_amount = s.installmentsMin;
  return row;
};

async function readBack(db: SupabaseClient, garageId: string): Promise<PaymentsSummary> {
  const { data: cfg, error } = await db
    .from('garage_payments')
    .select('provider, active, pos_shop_no, max_installments, installments_min_amount, auth_failed_at')
    .eq('garage_id', garageId)
    .single();
  if (error) throw new Error(`Verification failed: ${error.message}`);
  return {
    provider: String(cfg.provider),
    active: Boolean(cfg.active),
    shopNo: cfg.pos_shop_no == null ? null : String(cfg.pos_shop_no),
    maxInstallments: Number(cfg.max_installments),
    installmentsMin: Number(cfg.installments_min_amount),
    suspended: cfg.auth_failed_at != null,
  };
}

export interface ConnectPaymentsOptions extends PaymentSettings {
  garageId: string;
  env: EnvId;
  provider?: 'pelecard';
  credentials: { terminal: string; user: string; password: string };
  active: boolean;
  allowTestTerminal?: boolean;
  realTerminal?: boolean;
}

/** Store credentials and settings. Connecting (again) is also how card
 *  payments come back after the breaker switched them off: whoever does this
 *  has just put in credentials they checked. Cleared here and nowhere else. */
export async function connectPayments(db: SupabaseClient, opts: ConnectPaymentsOptions): Promise<PaymentsSummary> {
  const provider = opts.provider ?? 'pelecard';
  const problem = terminalProblem(opts.env, opts.credentials.terminal, {
    allowTestTerminal: Boolean(opts.allowTestTerminal),
    realTerminal: Boolean(opts.realTerminal),
  });
  if (problem === 'testTerminalOnProduction') {
    throw new Error("Refusing to connect Pelecard's TEST terminal on production. For a test garage only: allow the test terminal.");
  }
  if (problem === 'realTerminalNotConfirmed') {
    throw new Error("That is not Pelecard's test terminal, and this is not production. Confirm it is a real terminal.");
  }

  const now = new Date().toISOString();
  const { terminal, user, password } = opts.credentials;
  {
    const { error } = await db.from('garage_payment_secrets').upsert(
      { garage_id: opts.garageId, credentials: { terminal: terminal.trim(), user: user.trim(), password }, updated_at: now },
      { onConflict: 'garage_id' },
    );
    if (error) throw new Error(`Could not store the credentials: ${error.message}`);
  }
  {
    const row = {
      garage_id: opts.garageId, provider, active: opts.active,
      auth_failed_at: null, auth_error: null, updated_at: now,
      ...settingsColumns(opts),
    };
    const { error } = await db.from('garage_payments').upsert(row, { onConflict: 'garage_id' });
    if (error) throw new Error(`Could not write the payment settings: ${error.message}`);
  }

  const { data: sec } = await db.from('garage_payment_secrets').select('credentials').eq('garage_id', opts.garageId).single();
  if (!(sec?.credentials as { password?: unknown } | undefined)?.password) {
    throw new Error('Stored, but the password came back empty.');
  }
  return readBack(db, opts.garageId);
}

/** Settings only — no credentials read or written. Also gives installment
 *  limits to a garage with NO provider (a card taken on its own terminal,
 *  recorded by hand). On/off changes only when `active` is given, and turning
 *  on needs stored credentials and no suspension. */
export async function updatePaymentSettings(
  db: SupabaseClient,
  garageId: string,
  settings: PaymentSettings & { active?: boolean },
): Promise<PaymentsSummary> {
  const { data: cur } = await db.from('garage_payments').select('active, auth_failed_at').eq('garage_id', garageId).maybeSingle();
  const { data: sec } = await db.from('garage_payment_secrets').select('garage_id').eq('garage_id', garageId).maybeSingle();
  if (settings.active === true && !sec) {
    throw new Error('No credentials stored for this garage — connect it first.');
  }
  if (settings.active === true && cur?.auth_failed_at) {
    throw new Error('Card payments were suspended because Pelecard rejected the credentials. Reconnect with checked credentials — that lifts it.');
  }

  const row: Record<string, unknown> = { garage_id: garageId, provider: 'pelecard', updated_at: new Date().toISOString(), ...settingsColumns(settings) };
  if (settings.active !== undefined) row.active = settings.active;
  else if (!cur) row.active = false; // a new row: settings, payments off
  const { error } = await db.from('garage_payments').upsert(row, { onConflict: 'garage_id' });
  if (error) throw new Error(`Could not write the payment settings: ${error.message}`);
  return readBack(db, garageId);
}
