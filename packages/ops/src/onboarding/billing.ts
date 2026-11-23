/* Invoicing and bookkeeping settings. The writes behind connect-billing.mjs,
 * set-bookkeeping-software.mjs and the console's onboarding form.
 *
 *   * garage_billing         — provider, active, vat_rate, doc_type, and the
 *     bookkeeping columns. Members may READ it (the app shows "invoicing
 *     connected"); only service_role writes it.
 *   * garage_billing_secrets — the provider credentials, no grant to anybody
 *     but service_role, so a token never reaches a client or a PostgREST reply.
 *
 * Tokens are never returned whole: only their last four characters, so a wrong
 * paste is visible without the secret ever being logged.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { BillingProvider, BookkeepingSoftware, InvoiceDocType } from '../types.ts';

export interface ConnectBillingOptions {
  garageId: string;
  provider: BillingProvider | string;
  /** iCount: { cid, token }. Another provider: whatever its adapter reads. */
  credentials: Record<string, string>;
  /** Omit to keep the column default (0.18) or the existing value. */
  vatRate?: number;
  /** Omit to keep the column default or the existing value. */
  docType?: InvoiceDocType;
  active: boolean;
}

export interface BillingSummary {
  provider: string;
  vatRate: number;
  docType: string;
  active: boolean;
  cid: string | null;
  tokenTail: string;
}

export const tail = (secret: unknown): string =>
  typeof secret === 'string' && secret.length >= 4 ? `••••${secret.slice(-4)}` : '(missing!)';

export async function connectBilling(db: SupabaseClient, opts: ConnectBillingOptions): Promise<BillingSummary> {
  const now = new Date().toISOString();

  {
    const { error } = await db
      .from('garage_billing_secrets')
      .upsert({ garage_id: opts.garageId, credentials: opts.credentials, updated_at: now }, { onConflict: 'garage_id' });
    if (error) throw new Error(`Could not store the credentials: ${error.message}`);
  }

  {
    const row: Record<string, unknown> = { garage_id: opts.garageId, provider: opts.provider, active: opts.active, updated_at: now };
    if (opts.vatRate !== undefined) row.vat_rate = opts.vatRate;
    if (opts.docType !== undefined) row.doc_type = opts.docType;
    const { error } = await db.from('garage_billing').upsert(row, { onConflict: 'garage_id' });
    if (error) throw new Error(`Could not write the billing settings: ${error.message}`);
  }

  // Verify, rather than assume.
  const { data: cfg, error: cfgErr } = await db
    .from('garage_billing').select('provider, vat_rate, doc_type, active').eq('garage_id', opts.garageId).single();
  if (cfgErr) throw new Error(`Verification failed reading garage_billing: ${cfgErr.message}`);
  const { data: sec, error: secErr } = await db
    .from('garage_billing_secrets').select('credentials').eq('garage_id', opts.garageId).single();
  if (secErr) throw new Error(`Verification failed reading garage_billing_secrets: ${secErr.message}`);

  const creds = (sec.credentials ?? {}) as Record<string, unknown>;
  if (!creds.token) throw new Error('Stored, but the token came back empty — check the token.');
  return {
    provider: String(cfg.provider),
    vatRate: Number(cfg.vat_rate),
    docType: String(cfg.doc_type),
    active: Boolean(cfg.active),
    cid: creds.cid == null ? null : String(creds.cid),
    tokenTail: tail(creds.token),
  };
}

/** Which software the bookkeeper imports into. The two need different files,
 *  and a file built for the wrong one imports without complaint into the wrong
 *  movement types — so there is no default, and exports are refused until set.
 *  Needs the garage connected first: this is a column on garage_billing. */
export async function setBookkeeping(
  db: SupabaseClient,
  garageId: string,
  settings: { software?: BookkeepingSoftware | null; accountantEmail?: string | null },
): Promise<{ software: string | null; accountantEmail: string | null }> {
  const { data: billing, error: bErr } = await db
    .from('garage_billing').select('garage_id').eq('garage_id', garageId).maybeSingle();
  if (bErr) throw new Error(`Could not read garage_billing: ${bErr.message}`);
  if (!billing) throw new Error('The garage is not connected to an accounting provider yet — connect billing first.');

  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (settings.software !== undefined) row.bookkeeping_software = settings.software;
  if (settings.accountantEmail !== undefined) row.accountant_email = settings.accountantEmail?.trim() || null;

  const { error } = await db.from('garage_billing').update(row).eq('garage_id', garageId);
  if (error) throw new Error(`Could not write: ${error.message}`);

  const { data: after, error: aErr } = await db
    .from('garage_billing').select('bookkeeping_software, accountant_email').eq('garage_id', garageId).single();
  if (aErr) throw new Error(`Written, but could not read it back: ${aErr.message}`);
  if (settings.software !== undefined && after.bookkeeping_software !== settings.software) {
    throw new Error(`Read back "${String(after.bookkeeping_software)}" — expected "${String(settings.software)}".`);
  }
  return {
    software: after.bookkeeping_software == null ? null : String(after.bookkeeping_software),
    accountantEmail: after.accountant_email == null ? null : String(after.accountant_email),
  };
}
