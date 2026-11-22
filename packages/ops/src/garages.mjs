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

import { serviceClient } from './environments.mjs';

/** A table that does not exist in this environment yet (its migration is
 *  pending) reads as `missing`, not as an error and not as empty. */
const MISSING = /PGRST205|42P01|does not exist|Could not find the table/i;

async function readTable(db, table, columns = '*') {
  const { data, error } = await db.from(table).select(columns);
  if (!error) return { rows: data ?? [], missing: false };
  if (MISSING.test(`${error.code} ${error.message}`)) return { rows: [], missing: true };
  throw new Error(`${table}: ${error.message}`);
}

async function allUsers(db) {
  const users = [];
  for (let page = 1; page < 100; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`auth users: ${error.message}`);
    users.push(...data.users);
    if (data.users.length < 1000) break;
  }
  return users;
}

export async function listGarages(id) {
  const db = await serviceClient(id);

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
  const byGarage = (rows) => new Map(rows.map((r) => [r.garage_id, r]));
  const billingOf = byGarage(billing.rows);
  const paymentsOf = byGarage(payments.rows);
  const hasBillingSecret = new Set(billingSecrets.rows.map((r) => r.garage_id));
  const hasPaymentSecret = new Set(paymentSecrets.rows.map((r) => r.garage_id));

  const result = garages.rows
    .map((g) => {
      const b = billingOf.get(g.id) ?? null;
      const p = paymentsOf.get(g.id) ?? null;
      return {
        id: g.id,
        name: g.name,
        createdAt: g.created_at,
        letterhead: {
          printName: g.print_name, motto: g.motto, services: g.services, address: g.address,
          phone: g.phone, fax: g.fax, licenseNo: g.license_no, taxId: g.tax_id,
        },
        members: members.rows
          .filter((m) => m.garage_id === g.id)
          .map((m) => ({ email: emailOf.get(m.user_id) ?? '(משתמש לא נמצא)', role: m.role, lastSignIn: lastSignIn.get(m.user_id) ?? null }))
          .sort((a, b2) => (a.role === b2.role ? String(a.email).localeCompare(String(b2.email)) : a.role === 'admin' ? -1 : 1)),
        invoicing: b && {
          provider: b.provider,
          active: b.active,
          docType: b.doc_type,
          vatRate: b.vat_rate,
          credentials: hasBillingSecret.has(g.id),
          updatedAt: b.updated_at,
        },
        bookkeeping: b && {
          software: b.bookkeeping_software,
          accountantEmail: b.accountant_email,
        },
        payments: p && {
          provider: p.provider,
          active: p.active,
          shopNo: p.pos_shop_no,
          maxInstallments: p.max_installments,
          installmentsMin: p.installments_min_amount,
          credentials: hasPaymentSecret.has(g.id),
          authFailedAt: p.auth_failed_at,
          authError: p.auth_error,
          updatedAt: p.updated_at,
        },
      };
    })
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));

  return {
    env: id,
    garages: result,
    missingTables: Object.entries({ garage_billing: billing, garage_payments: payments })
      .filter(([, t]) => t.missing)
      .map(([name]) => name),
  };
}
