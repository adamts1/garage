/* Every garage in one environment, with who belongs to it and which services
 * it has: invoicing (garage_billing), card clearing (garage_payments) and the
 * bookkeeping export settings that live on garage_billing.
 *
 * Read-only. Secrets are never read: for the two *_secrets tables only the
 * garage_id is selected, which says "credentials stored" and nothing more.
 *
 * Columns are selected with `*` on purpose. The environments are not on the
 * same migration at any given moment, and naming a column one of them lacks
 * would fail the whole page. A column that is missing simply comes back
 * undefined, and the page shows it as unknown.
 */

import type { SupabaseClient, User } from '@supabase/supabase-js';
import { serviceClient } from './environments.ts';
import type {
  BookkeepingSoftware,
  EnvId,
  GarageOverview,
  GaragesReport,
  InvoiceDocType,
  MemberRole,
} from './types.ts';

type Row = Record<string, unknown>;

/** A table that does not exist in this environment yet (its migration is
 *  pending) reads as `missing`, not as an error and not as empty. */
const MISSING = /PGRST205|42P01|does not exist|Could not find the table/i;

async function readTable(db: SupabaseClient, table: string, columns = '*'): Promise<{ rows: Row[]; missing: boolean }> {
  const { data, error } = await db.from(table).select(columns);
  if (!error) return { rows: (data ?? []) as unknown as Row[], missing: false };
  if (MISSING.test(`${error.code} ${error.message}`)) return { rows: [], missing: true };
  throw new Error(`${table}: ${error.message}`);
}

export async function allUsers(db: SupabaseClient): Promise<User[]> {
  const users: User[] = [];
  for (let page = 1; page < 100; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`auth users: ${error.message}`);
    users.push(...data.users);
    if (data.users.length < 1000) break;
  }
  return users;
}

const str = (v: unknown): string | null => (v == null ? null : String(v));
/** undefined stays undefined: "this environment has no such column". */
const optStr = (v: unknown): string | null | undefined => (v === undefined ? undefined : str(v));

export async function listGarages(id: EnvId): Promise<GaragesReport> {
  const { db } = await serviceClient(id);

  const [garages, members, billing, billingSecrets, payments, paymentSecrets, users] = await Promise.all([
    readTable(db, 'garages'),
    readTable(db, 'garage_members', 'garage_id, user_id, role, created_at'),
    readTable(db, 'garage_billing'),
    readTable(db, 'garage_billing_secrets', 'garage_id'),
    readTable(db, 'garage_payments'),
    readTable(db, 'garage_payment_secrets', 'garage_id'),
    allUsers(db),
  ]);
  if (garages.missing) throw new Error('אין טבלת garages בסביבה הזו');

  const emailOf = new Map(users.map((u) => [u.id, u.email ?? null]));
  const lastSignIn = new Map(users.map((u) => [u.id, u.last_sign_in_at ?? null]));
  const byGarage = (rows: Row[]) => new Map(rows.map((r) => [r.garage_id, r]));
  const billingOf = byGarage(billing.rows);
  const paymentsOf = byGarage(payments.rows);
  const hasBillingSecret = new Set(billingSecrets.rows.map((r) => r.garage_id));
  const hasPaymentSecret = new Set(paymentSecrets.rows.map((r) => r.garage_id));

  const result: GarageOverview[] = garages.rows
    .map((g) => {
      const b = billingOf.get(g.id);
      const p = paymentsOf.get(g.id);
      return {
        id: String(g.id),
        name: String(g.name),
        createdAt: String(g.created_at),
        letterhead: {
          printName: str(g.print_name), motto: str(g.motto), services: str(g.services), address: str(g.address),
          phone: str(g.phone), fax: str(g.fax), licenseNo: str(g.license_no), taxId: str(g.tax_id),
        },
        members: members.rows
          .filter((m) => m.garage_id === g.id)
          .map((m) => ({
            email: emailOf.get(String(m.user_id)) ?? '(משתמש לא נמצא)',
            role: m.role as MemberRole,
            lastSignIn: lastSignIn.get(String(m.user_id)) ?? null,
          }))
          .sort((a, c) => (a.role === c.role ? a.email.localeCompare(c.email) : a.role === 'admin' ? -1 : 1)),
        invoicing: b
          ? {
              provider: String(b.provider),
              active: Boolean(b.active),
              docType: b.doc_type as InvoiceDocType,
              vatRate: Number(b.vat_rate),
              credentials: hasBillingSecret.has(g.id),
              updatedAt: String(b.updated_at),
            }
          : null,
        bookkeeping: b
          ? {
              software: optStr(b.bookkeeping_software) as BookkeepingSoftware | null | undefined,
              accountantEmail: optStr(b.accountant_email),
            }
          : null,
        payments: p
          ? {
              provider: String(p.provider),
              active: Boolean(p.active),
              shopNo: str(p.pos_shop_no),
              maxInstallments: Number(p.max_installments),
              installmentsMin: Number(p.installments_min_amount),
              credentials: hasPaymentSecret.has(g.id),
              authFailedAt: optStr(p.auth_failed_at),
              authError: optStr(p.auth_error),
              updatedAt: String(p.updated_at),
            }
          : null,
      };
    })
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  return {
    env: id,
    garages: result,
    missingTables: Object.entries({ garage_billing: billing, garage_payments: payments })
      .filter(([, t]) => t.missing)
      .map(([name]) => name),
  };
}
