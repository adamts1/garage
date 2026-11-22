// The clearing providers this system can use, and the one a garage is set up
// with. Shared by card-payment (which charges) and issue-invoice (which
// refunds when it credits), so both pick the provider the same way. A new
// provider is a folder beside pelecard/ and one line in PAYMENT_ADAPTERS.

import { pelecardAdapter } from './pelecard/adapter.ts';
import { ProviderAuthError } from './provider.ts';
import type { PaymentCredentials, PaymentProvider } from './provider.ts';

/** Card payments switched off because the provider rejected the credentials.
 *  Nothing may be sent to the provider until an admin reconnects. */
export class PaymentsSuspended extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PaymentsSuspended';
  }
}

export const PAYMENT_ADAPTERS: Record<string, PaymentProvider> = {
  pelecard: pelecardAdapter,
};

export interface GarageProvider {
  name: string;
  adapter: PaymentProvider;
  credentials: PaymentCredentials;
  posShopNo: string | null;
  maxInstallments: number;
  installmentsMinAmount: number;
}

/** The garage's provider, read with the service_role client. Throws when the
 *  garage has none, or it is off — `requireActive: false` for a refund, which
 *  must still be possible after a garage stops taking cards. */
// deno-lint-ignore no-explicit-any
export async function garageProvider(admin: any, garageId: string, requireActive = true): Promise<GarageProvider> {
  const { data: cfg } = await admin.from('garage_payments').select('*').eq('garage_id', garageId).maybeSingle();
  /* Before anything else, refunds included: a call with credentials the
     provider has already rejected is one more failed login toward a lock. */
  if (cfg?.auth_failed_at) {
    throw new PaymentsSuspended(`card payments are suspended: the provider rejected the credentials (${cfg.auth_error ?? 'no detail'}) — an admin must reconnect them`);
  }
  if (!cfg || (requireActive && !cfg.active)) throw new Error('card payments are not configured for this garage');
  const adapter = PAYMENT_ADAPTERS[cfg.provider];
  if (!adapter) throw new Error(`unknown payment provider: ${cfg.provider}`);
  const { data: sec } = await admin.from('garage_payment_secrets').select('credentials').eq('garage_id', garageId).maybeSingle();
  if (!sec?.credentials) throw new Error('payment credentials missing for this garage');
  return {
    name: cfg.provider as string,
    adapter,
    credentials: sec.credentials as PaymentCredentials,
    posShopNo: (cfg.pos_shop_no as string | null) || null,
    maxInstallments: Number(cfg.max_installments ?? 1),
    installmentsMinAmount: Number(cfg.installments_min_amount ?? 0),
  };
}

/** The breaker. Called with whatever a provider call threw: a credential
 *  rejection switches the garage's card payments off at once and records why
 *  (see migration 20261123090000), then comes back as PaymentsSuspended. Any
 *  other error comes back as it was. */
// deno-lint-ignore no-explicit-any
export async function tripOnAuth(admin: any, garageId: string, e: unknown): Promise<unknown> {
  if (!(e instanceof ProviderAuthError)) return e;
  const { error } = await admin.from('garage_payments')
    .update({ active: false, auth_failed_at: new Date().toISOString(), auth_error: e.message })
    .eq('garage_id', garageId);
  if (error) console.error(`garage ${garageId}: credentials rejected (${e.message}) but payments NOT switched off`, error.message);
  console.error(`garage ${garageId}: card payments suspended — ${e.message}`);
  return new PaymentsSuspended(`card payments are suspended: ${e.message} — an admin must reconnect them`);
}
