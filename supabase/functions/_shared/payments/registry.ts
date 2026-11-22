// The clearing providers this system can use, and the one a garage is set up
// with. Shared by card-payment (which charges) and issue-invoice (which
// refunds when it credits), so both pick the provider the same way. A new
// provider is a folder beside pelecard/ and one line in PAYMENT_ADAPTERS.

import { pelecardAdapter } from './pelecard/adapter.ts';
import type { PaymentCredentials, PaymentProvider } from './provider.ts';

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
