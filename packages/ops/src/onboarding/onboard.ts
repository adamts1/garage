/* A whole new garage in one go: the garage and its letterhead, its first admin,
 * optionally a starter catalog, invoicing, bookkeeping and card clearing.
 *
 * The same functions the scripts call, in the order an operator would run the
 * scripts. There is no transaction across them — auth users and tables cannot
 * share one — so a failure stops the run where it is and the result says
 * exactly which steps happened. The garage id is returned as soon as it
 * exists: the rest can then be finished by hand rather than repeated, which
 * would create a second garage.
 */

import { randomBytes } from 'node:crypto';
import type { ServiceConnection } from '../environments.ts';
import type { OnboardingInput, OnboardingResult, OnboardingStep, OnboardingStepId } from '../types.ts';
import { connectBilling, setBookkeeping } from './billing.ts';
import { createGarage, ensureUser, linkMember, seedStarterCatalog, verifyMembership } from './garage.ts';
import { connectPayments, updatePaymentSettings } from './payments.ts';
import { normalizeEmail, validateOnboarding } from './rules.ts';

export class OnboardingInvalid extends Error {
  readonly errors: Record<string, string | undefined>;
  constructor(errors: Record<string, string | undefined>) {
    super('the onboarding has invalid fields');
    this.errors = errors;
  }
}

export const generatePassword = (): string => randomBytes(9).toString('base64url');

export async function onboardGarage(conn: ServiceConnection, input: OnboardingInput): Promise<OnboardingResult> {
  const errors = validateOnboarding(input);
  if (Object.keys(errors).length) throw new OnboardingInvalid(errors);

  const { db, projectRef } = conn;
  const steps: OnboardingStep[] = [];
  const result: OnboardingResult = { ok: false, env: input.env, projectRef, garageId: null, steps, login: null };

  const step = async (id: OnboardingStepId, work: () => Promise<string | undefined>) => {
    try {
      steps.push({ id, ok: true, detail: await work() });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      steps.push({ id, ok: false, detail: message });
      throw e;
    }
  };

  try {
    await step('garage', async () => {
      result.garageId = await createGarage(db, input.garage.name, input.garage.letterhead);
      return result.garageId;
    });
    const garageId = result.garageId as string;

    const email = normalizeEmail(input.admin.email);
    const generated = input.admin.password ? null : generatePassword();
    let userId = '';
    await step('user', async () => {
      const user = await ensureUser(db, email, input.admin.password || (generated as string));
      userId = user.userId;
      result.login = { email, password: user.existing ? null : generated, existingUser: user.existing };
      return user.existing ? 'existing' : 'created';
    });

    await step('membership', async () => {
      await linkMember(db, garageId, userId, 'admin');
      return 'admin';
    });

    if (input.garage.seedCatalog) {
      await step('catalog', async () => {
        const { works, parts } = await seedStarterCatalog(db, garageId);
        return `${works} / ${parts}`;
      });
    }

    const inv = input.invoicing;
    if (inv) {
      await step('invoicing', async () => {
        const s = await connectBilling(db, {
          garageId,
          provider: inv.provider,
          credentials: { cid: inv.cid.trim(), token: inv.token.trim() },
          vatRate: inv.vatRate,
          docType: inv.docType,
          active: inv.active,
        });
        return `${s.provider} · ${s.tokenTail}`;
      });
    }

    const bk = input.bookkeeping;
    if (bk && (bk.software || bk.accountantEmail.trim())) {
      await step('bookkeeping', async () => {
        const s = await setBookkeeping(db, garageId, {
          software: bk.software ?? undefined,
          accountantEmail: bk.accountantEmail.trim() || undefined,
        });
        return s.software ?? '';
      });
    }

    const pay = input.payments;
    if (pay) {
      await step('payments', async () => {
        const settings = {
          shopNo: pay.shopNo.trim() || null,
          maxInstallments: pay.maxInstallments,
          installmentsMin: pay.installmentsMin,
        };
        const s = pay.credentials
          ? await connectPayments(db, {
              garageId, env: input.env, credentials: pay.credentials, active: pay.active,
              allowTestTerminal: pay.allowTestTerminal, realTerminal: pay.realTerminal, ...settings,
            })
          : await updatePaymentSettings(db, garageId, { ...settings, active: false });
        return `${s.provider} · ${s.active ? 'on' : 'off'}`;
      });
    }

    await step('verify', async () => {
      await verifyMembership(db, userId, garageId);
      return undefined;
    });

    result.ok = true;
  } catch (e) {
    result.error = e instanceof Error ? e.message : String(e);
  }
  return result;
}
