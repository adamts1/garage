/* Supplier expense management — the "money out" side.

   Unlike invoices, these are the garage's OWN bookkeeping entries (the supplier
   issued the document; the garage records it), so the app reads and writes them
   directly against tenant-scoped tables — full CRUD, no provider-owned number,
   no immutability. The one privileged step is the sync to the accounting
   provider, which runs in the record-expense Edge Function (it holds the
   provider credentials and writes the provider ids back).

   See docs/PRODUCTION.md §4c and migration 20260728000000_suppliers_and_expenses.sql. */

import { getClient } from './client';

/* ---------------- suppliers ---------------- */

export interface Supplier {
  id: string;
  name: string;
  taxId: string | null;         // ח״פ / עוסק מורשה
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  providerSupplierId: string | null;
  createdAt: string;
}

const rowToSupplier = (r: any): Supplier => ({
  id: r.id,
  name: r.name,
  taxId: r.tax_id ?? null,
  phone: r.phone ?? null,
  email: r.email ?? null,
  address: r.address ?? null,
  notes: r.notes ?? null,
  providerSupplierId: r.provider_supplier_id ?? null,
  createdAt: r.created_at,
});

const supplierToRow = (s: Partial<Supplier>) => ({
  name: s.name,
  tax_id: s.taxId ?? null,
  phone: s.phone ?? null,
  email: s.email ?? null,
  address: s.address ?? null,
  notes: s.notes ?? null,
});

export const listSuppliers = async (): Promise<Supplier[]> => {
  const { data, error } = await getClient().from('suppliers').select('*').order('name');
  if (error) throw error;
  return (data ?? []).map(rowToSupplier);
};

export const createSupplier = async (s: Omit<Supplier, 'id' | 'providerSupplierId' | 'createdAt'>): Promise<Supplier> => {
  const { data, error } = await getClient().from('suppliers').insert(supplierToRow(s)).select().single();
  if (error) throw error;
  return rowToSupplier(data);
};

export const updateSupplier = async (id: string, patch: Partial<Omit<Supplier, 'id' | 'createdAt'>>) => {
  const { error } = await getClient().from('suppliers').update(supplierToRow(patch)).eq('id', id);
  if (error) throw error;
};

export const deleteSupplier = async (id: string) => {
  // Fails (FK restrict) if the supplier still has expenses — a clear error beats
  // silently orphaning the books.
  const { error } = await getClient().from('suppliers').delete().eq('id', id);
  if (error) throw error;
};

/* ---------------- expenses ---------------- */

export type ExpenseSyncStatus = 'pending' | 'synced' | 'error';

export interface SupplierExpense {
  id: string;
  supplierId: string;
  supplierName: string | null;   // joined for display
  date: string;                  // YYYY-MM-DD
  description: string | null;
  category: string | null;
  reference: string | null;
  subtotal: number;
  vatRate: number;
  vat: number;
  total: number;
  paid: boolean;
  provider: string;
  providerExpenseId: string | null;
  syncStatus: ExpenseSyncStatus;
  syncError: string | null;
  createdAt: string;
}

const rowToExpense = (r: any): SupplierExpense => ({
  id: r.id,
  supplierId: r.supplier_id,
  supplierName: r.suppliers?.name ?? null,
  date: r.expense_date,
  description: r.description ?? null,
  category: r.category ?? null,
  reference: r.reference ?? null,
  subtotal: Number(r.subtotal),
  vatRate: Number(r.vat_rate),
  vat: Number(r.vat),
  total: Number(r.total),
  paid: r.paid ?? false,
  provider: r.provider,
  providerExpenseId: r.provider_expense_id ?? null,
  syncStatus: r.sync_status,
  syncError: r.sync_error ?? null,
  createdAt: r.created_at,
});

const round2 = (n: number) => Math.round(n * 100) / 100;

export const listExpenses = async (): Promise<SupplierExpense[]> => {
  const { data, error } = await getClient()
    .from('supplier_expenses')
    .select('*, suppliers(name)')
    .order('expense_date', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(rowToExpense);
};

export interface ExpenseInput {
  supplierId: string;
  date: string;
  description?: string;
  category?: string;
  reference?: string;
  subtotal: number;
  vatRate: number;   // e.g. 0.18; 0 for a VAT-free expense
  paid?: boolean;
}

/** Insert the expense natively (garage_id fills from current_garage_id()). VAT
 *  and total are derived from subtotal + rate so the stored figures are
 *  consistent. Returns the row; sync to the provider is a separate call. */
export const createExpense = async (e: ExpenseInput): Promise<SupplierExpense> => {
  const vat = round2(e.subtotal * e.vatRate);
  const total = round2(e.subtotal + vat);
  const { data, error } = await getClient()
    .from('supplier_expenses')
    .insert({
      supplier_id: e.supplierId,
      expense_date: e.date,
      description: e.description ?? null,
      category: e.category ?? null,
      reference: e.reference ?? null,
      subtotal: e.subtotal,
      vat_rate: e.vatRate,
      vat,
      total,
      paid: e.paid ?? false,
    })
    .select('*, suppliers(name)')
    .single();
  if (error) throw error;
  return rowToExpense(data);
};

export const updateExpense = async (id: string, e: ExpenseInput) => {
  const vat = round2(e.subtotal * e.vatRate);
  const total = round2(e.subtotal + vat);
  const { error } = await getClient()
    .from('supplier_expenses')
    .update({
      supplier_id: e.supplierId,
      expense_date: e.date,
      description: e.description ?? null,
      category: e.category ?? null,
      reference: e.reference ?? null,
      subtotal: e.subtotal,
      vat_rate: e.vatRate,
      vat,
      total,
      paid: e.paid ?? false,
    })
    .eq('id', id);
  if (error) throw error;
};

export const setExpensePaid = async (id: string, paid: boolean) => {
  const { error } = await getClient().from('supplier_expenses').update({ paid }).eq('id', id);
  if (error) throw error;
};

export const deleteExpense = async (id: string) => {
  const { error } = await getClient().from('supplier_expenses').delete().eq('id', id);
  if (error) throw error;
};

/* Push an expense (and its supplier) into the accounting provider so it reaches
   the accountant's books / input-VAT. Runs in the Edge Function because it needs
   the provider credentials and writes the provider ids back. Returns the updated
   expense (sync_status synced, or error with a message). */
export const syncExpense = async (expenseId: string): Promise<SupplierExpense> => {
  const { data, error } = await getClient().functions.invoke('record-expense', {
    body: { expense_id: expenseId },
  });
  if (error) {
    let msg = error.message ?? 'sync failed';
    try { const b = await error?.context?.json?.(); if (b?.error) msg = b.error; } catch { /* keep msg */ }
    throw new Error(msg);
  }
  return rowToExpense(data.expense);
};

export const subscribeToExpenses = (onChange: () => void) => {
  const channel = getClient()
    .channel(`garage-expenses-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'supplier_expenses' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'suppliers' }, onChange)
    .subscribe();
  return () => void getClient().removeChannel(channel);
};
