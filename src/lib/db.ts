/* The one place that talks to Supabase.
   The UI keeps using the `Ticket` shape it always had - everything below
   maps between that shape and the tickets / works / work_items rows. */

import { supabase } from './supabase';
import type { Ticket } from '../board-data';
import type { PartRow, TicketWork } from '../catalog';

/* ---------------- customers ---------------- */

export interface Customer {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  kind: string;
}

export const listCustomers = async (): Promise<Customer[]> => {
  const { data, error } = await supabase
    .from('customers')
    .select('*')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data as Customer[];
};

export const createCustomer = async (c: Omit<Customer, 'id'>) => {
  const { data, error } = await supabase.from('customers').insert(c).select().single();
  if (error) throw error;
  return data as Customer;
};

export const updateCustomer = async (id: string, patch: Partial<Omit<Customer, 'id'>>) => {
  const { error } = await supabase.from('customers').update(patch).eq('id', id);
  if (error) throw error;
};

export const deleteCustomer = async (id: string) => {
  const { error } = await supabase.from('customers').delete().eq('id', id);
  if (error) throw error;
};

/* ---------------- items (parts catalog / stock) ---------------- */

export interface Item {
  id: string;
  sku: string;
  name: string;
  price: number;
  stock: number;
}

export const listItems = async (): Promise<Item[]> => {
  const { data, error } = await supabase.from('items').select('*').order('sku');
  if (error) throw error;
  return (data ?? []).map((r) => ({ ...r, price: Number(r.price), stock: Number(r.stock) })) as Item[];
};

export const createItem = async (i: Omit<Item, 'id'>) => {
  const { data, error } = await supabase.from('items').insert(i).select().single();
  if (error) throw error;
  return data as Item;
};

export const updateItem = async (id: string, patch: Partial<Omit<Item, 'id'>>) => {
  const { error } = await supabase.from('items').update(patch).eq('id', id);
  if (error) throw error;
};

export const deleteItem = async (id: string) => {
  const { error } = await supabase.from('items').delete().eq('id', id);
  if (error) throw error;
};

/* ---------------- tickets (+ their works and parts) ---------------- */

/** DB row -> the Ticket object every component already understands. */
const rowToTicket = (r: any): Ticket => ({
  k: r.key,
  st: r.status,
  type: r.type,
  epic: r.epic,
  prio: r.priority,
  pts: r.points,
  who: r.assignee,
  job: r.job ?? '',
  title: r.title,
  plate: r.plate ?? '',
  car: r.car ?? '',
  customer: r.customer_name ?? '',
  amount: Number(r.amount),
  done: r.done,
  subtasks: r.subtasks ?? [],
  due: r.due ?? '',
  flags: r.flags ?? [],
  blocked: r.blocked ?? undefined,
  phone: r.phone ?? undefined,
  email: r.email ?? undefined,
  address: r.address ?? undefined,
  km: r.km ?? undefined,
  year: r.year ?? undefined,
  notes: r.notes ?? undefined,
  createdAt: r.created_at ? new Date(r.created_at).toLocaleDateString('he-IL') : undefined,
  createdAtISO: r.created_at ?? undefined,
  paid: r.paid ?? undefined,
  payMethod: r.pay_method ?? undefined,
  doc: r.doc ?? undefined,
  reference: r.reference ?? undefined,
  works: (r.works ?? [])
    .slice()
    .sort((a: any, b: any) => a.position - b.position)
    .map(
      (w: any): TicketWork => ({
        uid: w.uid,
        code: w.code ?? '',
        name: w.name,
        labor: Number(w.labor),
        custom: w.custom,
        items: (w.work_items ?? [])
          .slice()
          .sort((a: any, b: any) => a.position - b.position)
          .map(
            (p: any): PartRow => ({
              sku: p.sku ?? '',
              name: p.name,
              qty: Number(p.qty),
              price: Number(p.price),
            }),
          ),
      }),
    ),
});

/** Ticket -> the columns of the tickets table (works live in their own tables). */
const ticketToRow = (t: Ticket) => ({
  key: t.k,
  job: t.job,
  status: t.st,
  type: t.type,
  epic: t.epic,
  priority: t.prio,
  points: t.pts,
  assignee: t.who,
  title: t.title,
  plate: t.plate,
  car: t.car,
  customer_name: t.customer,
  amount: t.amount,
  done: t.done,
  subtasks: t.subtasks,
  flags: t.flags,
  due: t.due,
  blocked: t.blocked ?? null,
  phone: t.phone ?? null,
  email: t.email ?? null,
  address: t.address ?? null,
  km: t.km ?? null,
  year: t.year ?? null,
  notes: t.notes ?? null,
  paid: t.paid ?? false,
  pay_method: t.payMethod ?? null,
  doc: t.doc ?? null,
  reference: t.reference ?? null,
});

export const listTickets = async (): Promise<Ticket[]> => {
  const { data, error } = await supabase
    .from('tickets')
    .select('*, works(*, work_items(*))')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(rowToTicket);
};

const ticketIdByKey = async (key: string): Promise<string> => {
  const { data, error } = await supabase.from('tickets').select('id').eq('key', key).single();
  if (error) throw error;
  return data.id as string;
};

/** Rewrite a ticket's works and their parts. Simple and correct: wipe, re-insert. */
const saveWorks = async (ticketId: string, works: TicketWork[]) => {
  const { error: delErr } = await supabase.from('works').delete().eq('ticket_id', ticketId);
  if (delErr) throw delErr;
  if (!works.length) return;

  const { data: rows, error: workErr } = await supabase
    .from('works')
    .insert(
      works.map((w, i) => ({
        ticket_id: ticketId,
        uid: w.uid,
        code: w.code,
        name: w.name,
        labor: w.labor,
        custom: w.custom ?? false,
        position: i,
      })),
    )
    .select('id, uid');
  if (workErr) throw workErr;

  const idByUid = new Map((rows ?? []).map((r) => [r.uid as string, r.id as string]));
  const parts = works.flatMap((w) =>
    w.items.map((p, i) => ({
      work_id: idByUid.get(w.uid)!,
      sku: p.sku,
      name: p.name,
      qty: p.qty,
      price: p.price,
      position: i,
    })),
  );
  if (!parts.length) return;

  const { error: partErr } = await supabase.from('work_items').insert(parts);
  if (partErr) throw partErr;
};

/** A new ticket names its customer. Reuse that customer if we know them, otherwise open a card. */
export const findOrCreateCustomer = async (t: Ticket): Promise<string | null> => {
  if (!t.customer) return null;

  const { data: found, error } = await supabase
    .from('customers')
    .select('id')
    .eq('name', t.customer)
    .maybeSingle();
  if (error) throw error;
  if (found) return found.id;

  const { data: created, error: insErr } = await supabase
    .from('customers')
    .insert({
      name: t.customer,
      phone: t.phone ?? null,
      email: t.email ?? null,
      address: t.address ?? null,
      kind: (t.flags ?? []).includes('עסקי') ? 'עסקי' : 'פרטי',
    })
    .select('id')
    .single();
  if (insErr) throw insErr;
  return created.id;
};

export const createTicket = async (t: Ticket, customerId?: string | null) => {
  const { data, error } = await supabase
    .from('tickets')
    .insert({ ...ticketToRow(t), customer_id: customerId ?? null })
    .select('id')
    .single();
  if (error) throw error;
  await saveWorks(data.id, t.works ?? []);
};

/** `worksChanged` is false on a status drag, so we don't rewrite the works tables for nothing. */
export const updateTicket = async (t: Ticket, worksChanged: boolean) => {
  const { error } = await supabase.from('tickets').update(ticketToRow(t)).eq('key', t.k);
  if (error) throw error;
  if (worksChanged) await saveWorks(await ticketIdByKey(t.k), t.works ?? []);
};

export const deleteTicket = async (key: string) => {
  const { error } = await supabase.from('tickets').delete().eq('key', key);
  if (error) throw error; // works + work_items go with it (on delete cascade)
};

/* ---------------- realtime ---------------- */

/** Fires `onChange` whenever anyone, anywhere, touches a ticket / work / part. */
export const subscribeToTickets = (onChange: () => void) => {
  const channel = supabase
    .channel('garage-tickets')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tickets' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'works' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'work_items' }, onChange)
    .subscribe();
  return () => void supabase.removeChannel(channel);
};

/** Same, for the customers and items pages. */
export const subscribeToTable = (table: 'customers' | 'items', onChange: () => void) => {
  const channel = supabase
    .channel(`garage-${table}`)
    .on('postgres_changes', { event: '*', schema: 'public', table }, onChange)
    .subscribe();
  return () => void supabase.removeChannel(channel);
};
