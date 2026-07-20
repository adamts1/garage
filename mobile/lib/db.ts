/* The one place that talks to Supabase - the mobile twin of ../../src/lib/db.ts.
   Same tables, same mapping, same wipe-and-reinsert strategy for works.
   Keep the two in step: a change to the ticket columns belongs in both files. */

import { supabase } from './supabase';
import type { PartRow, Ticket, TicketWork } from './types';

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
  return (data ?? []).map((r) => ({
    ...r,
    price: Number(r.price),
    stock: Number(r.stock),
  })) as Item[];
};

/* ---------------- tickets (+ their works and parts) ---------------- */

/** DB row -> the Ticket object the screens understand. */
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

/** `worksChanged` is false on a plain status change, so we don't rewrite the works tables for nothing. */
export const updateTicket = async (t: Ticket, worksChanged: boolean) => {
  const { error } = await supabase.from('tickets').update(ticketToRow(t)).eq('key', t.k);
  if (error) throw error;
  if (worksChanged) await saveWorks(await ticketIdByKey(t.k), t.works ?? []);
};

export const deleteTicket = async (key: string) => {
  const { error } = await supabase.from('tickets').delete().eq('key', key);
  if (error) throw error; // works + work_items go with it (on delete cascade)
};

/* ---------------- ticket photos ---------------- */

export const PHOTO_BUCKET = 'ticket-photos';

export interface TicketPhoto {
  id: string;
  path: string;      // object path inside the bucket - what we delete by
  url: string;       // public CDN url - what <Image> renders
  caption: string;
  createdAt: string;
}

const photoUrl = (path: string) =>
  supabase.storage.from(PHOTO_BUCKET).getPublicUrl(path).data.publicUrl;

const rowToPhoto = (r: any): TicketPhoto => ({
  id: r.id,
  path: r.path,
  url: photoUrl(r.path),
  caption: r.caption ?? '',
  createdAt: r.created_at ? new Date(r.created_at).toLocaleDateString('he-IL') : '',
});

/* RN's fetch can't reliably turn a file:// uri into a Blob, so the picker hands us
   base64 and we upload the bytes directly. Hermes has atob, but not on every RN
   version we might land on - 20 lines here is cheaper than depending on that. */
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const decodeBase64 = (input: string): Uint8Array => {
  const b64 = input.replace(/[^A-Za-z0-9+/]/g, '');            // drops padding and any newlines
  const bytes = new Uint8Array(Math.floor((b64.length * 3) / 4)); // 4 chars -> 3 bytes; a short final group carries 1 or 2
  // Past the end of the string indexOf gives -1, whose bits would corrupt the
  // bytes we do keep. Missing characters have to read as zero.
  const at = (i: number) => { const c = B64.indexOf(b64[i]); return c < 0 ? 0 : c; };
  let p = 0;
  for (let i = 0; i < b64.length; i += 4) {
    const n = (at(i) << 18) | (at(i + 1) << 12) | (at(i + 2) << 6) | at(i + 3);
    if (p < bytes.length) bytes[p++] = (n >> 16) & 0xff;
    if (p < bytes.length) bytes[p++] = (n >> 8) & 0xff;
    if (p < bytes.length) bytes[p++] = n & 0xff;
  }
  return bytes;
};

/** A ticket's photos, oldest first. One round trip: the embed filters by ticket key. */
export const listTicketPhotos = async (key: string): Promise<TicketPhoto[]> => {
  const { data, error } = await supabase
    .from('ticket_photos')
    .select('id, path, caption, created_at, tickets!inner(key)')
    .eq('tickets.key', key)
    .order('created_at');
  if (error) throw error;
  return (data ?? []).map(rowToPhoto);
};

/** Upload the bytes, then record the row. Foldered by ticket key so the bucket stays browsable. */
export const uploadTicketPhoto = async (
  key: string,
  file: { base64: string; mime: string; ext: string },
): Promise<TicketPhoto> => {
  const ticketId = await ticketIdByKey(key);
  const path = `${key}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${file.ext}`;

  const { error: upErr } = await supabase.storage
    .from(PHOTO_BUCKET)
    .upload(path, decodeBase64(file.base64), { contentType: file.mime, upsert: false });
  if (upErr) throw upErr;

  const { data, error } = await supabase
    .from('ticket_photos')
    .insert({ ticket_id: ticketId, path })
    .select('id, path, caption, created_at')
    .single();
  if (error) {
    // The row is what makes a photo visible; an object with no row is invisible junk.
    await supabase.storage.from(PHOTO_BUCKET).remove([path]);
    throw error;
  }
  return rowToPhoto(data);
};

/** Object first, then row: a failed object delete leaves the photo intact rather than broken. */
export const deleteTicketPhoto = async (photo: TicketPhoto) => {
  const { error: rmErr } = await supabase.storage.from(PHOTO_BUCKET).remove([photo.path]);
  if (rmErr) throw rmErr;
  const { error } = await supabase.from('ticket_photos').delete().eq('id', photo.id);
  if (error) throw error;
};

export const updatePhotoCaption = async (id: string, caption: string) => {
  const { error } = await supabase
    .from('ticket_photos')
    .update({ caption: caption.trim() || null })
    .eq('id', id);
  if (error) throw error;
};

/* ---------------- realtime ---------------- */

/** Fires `onChange` whenever anyone - the web app, another phone - touches a ticket / work / part. */
export const subscribeToTickets = (onChange: () => void) => {
  const channel = supabase
    .channel('garage-tickets-mobile')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tickets' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'works' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'work_items' }, onChange)
    .subscribe();
  return () => void supabase.removeChannel(channel);
};
