/* The one place that talks to Supabase.
   The UI keeps using the `Ticket` shape it always had - everything below
   maps between that shape and the tickets / works / work_items rows. */

import { getClient, invokeError } from './client';
import type { Ticket, Worker } from './types';
import type { PartRow, TicketWork, WorkDef } from './catalog';

/* ---------------- customers ---------------- */

export interface Customer {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  kind: string;
  /** ת״ז / company registration number. Sensitive — see docs/PRODUCTION.md §6. */
  id_number: string | null;
}

export const listCustomers = async (): Promise<Customer[]> => {
  const { data, error } = await getClient()
    .from('customers')
    .select('*')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data as Customer[];
};

export const createCustomer = async (c: Omit<Customer, 'id'>) => {
  const { data, error } = await getClient().from('customers').insert(c).select().single();
  if (error) throw error;
  return data as Customer;
};

export const updateCustomer = async (id: string, patch: Partial<Omit<Customer, 'id'>>) => {
  const { error } = await getClient().from('customers').update(patch).eq('id', id);
  if (error) throw error;
};

export const deleteCustomer = async (id: string) => {
  const { error } = await getClient().from('customers').delete().eq('id', id);
  if (error) throw error;
};

/* ---------------- vehicles (a customer's cars, for ticket auto-complete) ---------------- */

export interface Vehicle {
  id: string;
  customer_id: string;
  plate: string;
  manufacturer: string | null;
  model: string | null;
  year: string | null;
  km: string | null;
  vehicle_code: string | null;
}

export const listVehicles = async (): Promise<Vehicle[]> => {
  const { data, error } = await getClient()
    .from('vehicles')
    .select('*')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as Vehicle[];
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
  const { data, error } = await getClient().from('items').select('*').order('sku');
  if (error) throw error;
  return (data ?? []).map((r) => ({ ...r, price: Number(r.price), stock: Number(r.stock) })) as Item[];
};

export const createItem = async (i: Omit<Item, 'id'>) => {
  const { data, error } = await getClient().from('items').insert(i).select().single();
  if (error) throw error;
  return data as Item;
};

export const updateItem = async (id: string, patch: Partial<Omit<Item, 'id'>>) => {
  const { error } = await getClient().from('items').update(patch).eq('id', id);
  if (error) throw error;
};

export const deleteItem = async (id: string) => {
  const { error } = await getClient().from('items').delete().eq('id', id);
  if (error) throw error;
};

/* ---------------- the works catalog ----------------

   Standard jobs, each with a labour price and the parts it needs. This used to
   be WORK_CATALOG, a constant compiled into both apps, which meant every garage
   saw the same names and the same prices and changing one required a release.

   Note there is no separate parts catalog. PARTS_CATALOG was the same shape as
   the `items` table — sku, name, price — so `listItems()` above is the parts
   catalog, and a part invented while editing a work is just createItem().
   Keeping two lists of the same thing is what this phase is undoing.

   The caller never sends garage_id. It defaults to current_garage_id(), so a
   work belongs to whoever created it and cannot be aimed at another tenant. */

/** Rows arrive with the embedded parts under whatever alias PostgREST chose. */
const rowToWorkDef = (r: any): WorkDef => ({
  id: r.id,
  code: r.code,
  name: r.name,
  labor: Number(r.labor),
  hours: Number(r.hours),
  items: (r.work_def_items ?? [])
    .slice()
    .sort((a: any, b: any) => a.position - b.position)
    .map((p: any): PartRow => ({
      sku: p.sku ?? '',
      name: p.name,
      qty: Number(p.qty),
      price: Number(p.price),
    })),
});

/* ---------------- the team ----------------

   Every worker the garage has, retired ones included, in its own display order.
   Retired rows are deliberately not filtered out here: a ticket closed last year
   must still resolve to the mechanic who closed it. Callers that offer an
   assignment use assignableWorkers() to drop them; callers that render an
   existing ticket use workerMap()/workerChip() and want the full set. */
export const listWorkers = async (): Promise<Worker[]> => {
  const { data, error } = await getClient()
    .from('garage_workers')
    .select('id, code, name, initials, color, position, active, user_id')
    .order('position');
  if (error) throw error;
  return (data ?? []).map((r: any): Worker => ({
    id: r.id,
    code: r.code,
    name: r.name,
    initials: r.initials,
    color: r.color,
    position: r.position,
    active: r.active,
    userId: r.user_id ?? null,
  }));
};

/** A worker plus the login behind them: the shape the staff screen renders.
 *  `email` and `role` are null for a worker with no account — a mechanic who
 *  does not use the app, or a row that predates the two tables being joined. */
export interface Staff extends Worker {
  email: string | null;
  role: 'admin' | 'member' | null;
}

/* Three facts about one person from three places, one of which no client may
   read at all. See the garage_staff() comment in the migration: it is SECURITY
   DEFINER, takes no arguments, and returns nothing to a non-admin. */
export const listStaff = async (): Promise<Staff[]> => {
  const { data, error } = await getClient().rpc('garage_staff');
  if (error) throw error;
  return (data ?? []).map((r: any): Staff => ({
    id: r.id,
    code: r.code,
    name: r.name,
    initials: r.initials,
    color: r.color,
    position: r.position,
    active: r.active,
    userId: r.user_id ?? null,
    email: r.email ?? null,
    role: r.role ?? null,
  }));
};

/* Adding a person means creating an account, which needs the service_role key —
   so it cannot happen here. The manage-staff function does all three writes
   together (account, membership, worker) and undoes them as a unit if any step
   fails; see supabase/functions/manage-staff.

   The code is not a parameter. It is what tickets store in `assignee` and the
   function derives it, because it was a field on a form that nobody outside the
   database ever needed to see. */
export interface NewStaff {
  email: string;
  password: string;
  name: string;
  role: 'admin' | 'member';
  initials: string;
  color: string;
}

export const createStaff = async (s: NewStaff): Promise<Worker> => {
  const { data, error } = await getClient().functions.invoke('manage-staff', {
    body: { action: 'create', ...s },
  });
  if (error) throw await invokeError(error);
  const r = data.worker;
  return {
    id: r.id, code: r.code, name: r.name, initials: r.initials,
    color: r.color, position: r.position, active: r.active, userId: r.user_id ?? null,
  };
};

/** Promote or step somebody down. Refused by the function when it would leave
 *  the garage with no admin — there is no other way to appoint one. */
export const setStaffRole = async (userId: string, role: 'admin' | 'member'): Promise<void> => {
  const { error } = await getClient().functions.invoke('manage-staff', {
    body: { action: 'set_role', user_id: userId, role },
  });
  if (error) throw await invokeError(error);
};

/** What the staff screen may change directly. Deliberately not `code`, which
 *  tickets store and the function derives, and not `userId`, which is the link
 *  to an account and is set once when that account is made. */
export type WorkerEdit = Partial<Pick<Worker, 'name' | 'initials' | 'color' | 'position' | 'active'>>;

export const updateWorker = async (id: string, patch: WorkerEdit): Promise<void> => {
  const { error } = await getClient().from('garage_workers').update(patch).eq('id', id);
  if (error) throw error;
};

/** Retire, rather than delete. Keeps the name on every ticket they ever had. */
export const retireWorker = async (id: string): Promise<void> => updateWorker(id, { active: false });

/* Really delete. The foreign key is `on delete set null (assignee)`, so this
   also unassigns every ticket they ever had — the name stops appearing on work
   they actually did. retireWorker is almost always what a garage wants; this
   exists for a row entered by mistake. */
export const deleteWorker = async (id: string): Promise<void> => {
  const { error } = await getClient().from('garage_workers').delete().eq('id', id);
  if (error) throw error;
};

/** How many tickets name this worker — what a delete would silently unassign. */
export const countWorkerTickets = async (code: string): Promise<number> => {
  const { count, error } = await getClient()
    .from('tickets')
    .select('key', { count: 'exact', head: true })
    .eq('assignee', code);
  if (error) throw error;
  return count ?? 0;
};

/* First letters of the first two words: 'דני כהן' -> 'דכ'. Only a starting
   point for the initials field, which stays editable — two mechanics called
   דני would otherwise collide on the same chip. */
export const suggestInitials = (name: string): string =>
  name.trim().split(/\s+/).slice(0, 2).map((w) => w[0] ?? '').join('');

/** The garage's catalog, in its own display order. One round trip. */
export const listWorkDefs = async (): Promise<WorkDef[]> => {
  const { data, error } = await getClient()
    .from('work_defs')
    .select('id, code, name, labor, hours, position, work_def_items(sku, name, qty, price, position)')
    .order('position');
  if (error) throw error;
  return (data ?? []).map(rowToWorkDef);
};

/* Create a work and its parts.

   Two statements, not one: the parts need the work's id. If the parts insert
   fails the work is removed again, because a catalog work that silently lost
   its parts is worse than one that was never created — it looks correct in the
   list and produces a wrong quote when someone picks it. */
export const createWorkDef = async (def: Omit<WorkDef, 'id'>): Promise<WorkDef> => {
  const { data: row, error } = await getClient()
    .from('work_defs')
    .insert({ code: def.code, name: def.name, labor: def.labor, hours: def.hours })
    .select('id')
    .single();
  if (error) throw error;

  if (def.items.length) {
    const { error: partErr } = await getClient().from('work_def_items').insert(
      def.items.map((p, i) => ({
        work_def_id: row.id,
        sku: p.sku || null,
        name: p.name,
        qty: p.qty,
        price: p.price,
        position: i,
      })),
    );
    if (partErr) {
      await getClient().from('work_defs').delete().eq('id', row.id);
      throw partErr;
    }
  }
  return { ...def, id: row.id };
};

/** Rewrite a work and its parts. Wipe and re-insert, as saveWorks does. */
export const updateWorkDef = async (id: string, def: Omit<WorkDef, 'id'>): Promise<void> => {
  const { error } = await getClient()
    .from('work_defs')
    .update({ code: def.code, name: def.name, labor: def.labor, hours: def.hours })
    .eq('id', id);
  if (error) throw error;

  const { error: delErr } = await getClient().from('work_def_items').delete().eq('work_def_id', id);
  if (delErr) throw delErr;
  if (!def.items.length) return;

  const { error: partErr } = await getClient().from('work_def_items').insert(
    def.items.map((p, i) => ({
      work_def_id: id,
      sku: p.sku || null,
      name: p.name,
      qty: p.qty,
      price: p.price,
      position: i,
    })),
  );
  if (partErr) throw partErr;
};

/** Parts go with it — work_def_items cascades on the foreign key. */
export const deleteWorkDef = async (id: string) => {
  const { error } = await getClient().from('work_defs').delete().eq('id', id);
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
  // Nullable since 20260730000000: unassigned is NULL, not a phantom 'dk'.
  who: r.assignee ?? null,
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
        notes: w.notes ?? undefined,
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
  // '' would be a second way to say "nobody" and the foreign key rejects it as
  // a code, so it collapses to NULL here rather than at the database.
  assignee: t.who || null,
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
  const { data, error } = await getClient()
    .from('tickets')
    .select('*, works(*, work_items(*))')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(rowToTicket);
};

const ticketIdByKey = async (key: string): Promise<string> => {
  const { data, error } = await getClient().from('tickets').select('id').eq('key', key).single();
  if (error) throw error;
  return data.id as string;
};

/* Works and their parts, shaped for the create_ticket / save_ticket_works RPCs.
   position is assigned from array order here, so the server does not have to
   trust — or the client remember — a position field on every row. */
const worksPayload = (works: TicketWork[]) =>
  works.map((w, i) => ({
    uid: w.uid,
    code: w.code,
    name: w.name,
    labor: w.labor,
    custom: w.custom ?? false,
    // Trimmed to nothing collapses to null in the RPC, so a note cleared in the
    // UI does not come back as an empty string next time the ticket is opened.
    notes: w.notes?.trim() || null,
    position: i,
    items: w.items.map((p, j) => ({
      sku: p.sku,
      name: p.name,
      qty: p.qty,
      price: p.price,
      position: j,
    })),
  }));

/* Customer resolution used to live here as findOrCreateCustomer, matching on
   name with .maybeSingle(). It is gone: matching by name merged two different
   people and threw outright on a duplicate. Resolution now happens inside
   create_ticket — by an explicitly picked id, then ת״ז, then the phone's
   digits — in the ticket's own transaction. See §3.6, migration 20260725020000
   and 20260802010000. */

/* Create a ticket atomically. The server assigns the key and job number under a
   per-garage lock and resolves the customer, all in one transaction, so this no
   longer takes a customerId — create_ticket does that itself.

   Returns the server-assigned key so the optimistic UI can reconcile the
   temporary key it painted: two advisors submitting at once each get a distinct
   real number, which need not match what either client guessed. */
export const createTicket = async (t: Ticket): Promise<{ key: string; job: string }> => {
  // id_number + the vehicle fields ride along outside ticketToRow: they are not
  // tickets columns the row maps, but create_ticket reads them to fill the
  // customer (id_number) and to promote the car into the vehicles table.
  const payload = {
    ...ticketToRow(t),
    // The record the advisor picked, when they picked one. create_ticket
    // prefers it over matching by ת״ז/phone, after checking it is ours.
    customer_id: t.customerId ?? null,
    id_number: t.idNumber?.trim() || null,
    manufacturer: t.manufacturer?.trim() || null,
    model: t.model?.trim() || null,
    vehicle_code: t.vehicleCode?.trim() || null,
  };
  const { data, error } = await getClient().rpc('create_ticket', {
    t: payload,
    works: worksPayload(t.works ?? []),
  });
  if (error) throw error;
  const r = data as { key: string; job: string };
  return { key: r.key, job: r.job };
};

/** `worksChanged` is false on a status drag, so we don't rewrite the works tables for nothing. */
export const updateTicket = async (t: Ticket, worksChanged: boolean) => {
  const { error } = await getClient().from('tickets').update(ticketToRow(t)).eq('key', t.k);
  if (error) throw error;
  if (worksChanged) {
    // One transactional wipe-and-reinsert, not the old delete-then-insert that
    // could lose a ticket's job lines if it failed in between.
    const { error: wErr } = await getClient().rpc('save_ticket_works', {
      p_ticket_id: await ticketIdByKey(t.k),
      works: worksPayload(t.works ?? []),
    });
    if (wErr) throw wErr;
  }
};

export const deleteTicket = async (key: string) => {
  const { error } = await getClient().from('tickets').delete().eq('key', key);
  if (error) throw error; // works + work_items go with it (on delete cascade)
};

/* ---------------- ticket photos ---------------- */

/* Photos are taken, captioned and deleted on the phone; the board displays them.
   Both halves live here now, so the two apps cannot disagree about the shape of
   a photo or the order of an upload's two writes.

   The bucket is PRIVATE as of 2c. A photo is no longer a permanent CDN link but
   a signed URL minted for a caller the database has already authorised, so
   `url` is now produced by a round trip rather than by string concatenation —
   which is why building a TicketPhoto is async. See docs/PRODUCTION.md §3.3. */

export const PHOTO_BUCKET = 'ticket-photos';

/* Long enough that a board left open across a shift does not fill with broken
   images, short enough that a URL copied out of devtools is not a permanent
   grant. Photos are re-listed on every ticket open, so this is refreshed often
   in practice. */
const PHOTO_URL_TTL_SECONDS = 60 * 60 * 8;

export interface TicketPhoto {
  id: string;
  path: string;      // object path inside the bucket - what we delete by
  url: string;       // signed, expiring url - what the board and <Image> render
  caption: string;
  createdAt: string;
}

/* One signed URL per object.

   Signing is a network call, so this is batched by the caller rather than
   invoked per row in a loop. An object whose signature fails yields an empty
   string rather than throwing: one unreadable photo should leave the rest of
   the ticket usable, and a broken <img> is a better failure than a blank
   screen. */
const signPhotoUrls = async (paths: string[]): Promise<Map<string, string>> => {
  const out = new Map<string, string>();
  if (!paths.length) return out;
  const { data, error } = await getClient()
    .storage.from(PHOTO_BUCKET)
    .createSignedUrls(paths, PHOTO_URL_TTL_SECONDS);
  if (error) throw error;
  for (const entry of data ?? []) {
    if (entry.path) out.set(entry.path, entry.signedUrl ?? '');
  }
  return out;
};

const rowToPhoto = (r: any, url: string): TicketPhoto => ({
  id: r.id,
  path: r.path,
  url,
  caption: r.caption ?? '',
  createdAt: r.created_at ? new Date(r.created_at).toLocaleDateString('he-IL') : '',
});

/** A ticket's photos, oldest first. One query, then one batched signing call. */
export const listTicketPhotos = async (key: string): Promise<TicketPhoto[]> => {
  const { data, error } = await getClient()
    .from('ticket_photos')
    .select('id, path, caption, created_at, tickets!inner(key)')
    .eq('tickets.key', key)
    .order('created_at');
  if (error) throw error;

  const rows = data ?? [];
  const urls = await signPhotoUrls(rows.map((r) => r.path));
  return rows.map((r) => rowToPhoto(r, urls.get(r.path) ?? ''));
};

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

/* The caller's garage, asked of the database rather than assumed.

   Every other table fills garage_id from a column default, so the client has
   never needed to know this. Storage has no defaults — an object path is
   whatever the uploader says it is — so the prefix has to be built here, and
   the storage INSERT policy checks it.

   Not cached. A cached value outlives a sign-out, and the next user's photos
   would be written into the previous user's folder, where the policy would
   accept them because the path looks right. One round trip per upload is
   nothing next to the image bytes that follow it. */
const currentGarageId = async (): Promise<string> => {
  const { data, error } = await getClient().rpc('current_garage_id');
  if (error) throw error;
  if (!data) throw new Error('No garage for the current session — cannot upload a photo.');
  return data as string;
};

export const uploadTicketPhoto = async (
  key: string,
  file: { base64: string; mime: string; ext: string },
): Promise<TicketPhoto> => {
  const ticketId = await ticketIdByKey(key);
  const garageId = await currentGarageId();
  // The garage prefix is what the storage policy checks. The ticket key stays
  // in the path because it is what makes an object recognisable in the
  // dashboard when something needs looking at by hand.
  const path = `${garageId}/${key}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${file.ext}`;

  const { error: upErr } = await getClient()
    .storage.from(PHOTO_BUCKET)
    .upload(path, decodeBase64(file.base64), { contentType: file.mime, upsert: false });
  if (upErr) throw upErr;

  const { data, error } = await getClient()
    .from('ticket_photos')
    .insert({ ticket_id: ticketId, path })
    .select('id, path, caption, created_at')
    .single();
  if (error) {
    // The row is what makes a photo visible; an object with no row is invisible junk.
    await getClient().storage.from(PHOTO_BUCKET).remove([path]);
    throw error;
  }

  const urls = await signPhotoUrls([data.path]);
  return rowToPhoto(data, urls.get(data.path) ?? '');
};

/** Object first, then row: a failed object delete leaves the photo intact rather than broken. */
export const deleteTicketPhoto = async (photo: TicketPhoto) => {
  const { error: rmErr } = await getClient().storage.from(PHOTO_BUCKET).remove([photo.path]);
  if (rmErr) throw rmErr;
  const { error } = await getClient().from('ticket_photos').delete().eq('id', photo.id);
  if (error) throw error;
};

export const updatePhotoCaption = async (id: string, caption: string) => {
  const { error } = await getClient()
    .from('ticket_photos')
    .update({ caption: caption.trim() || null })
    .eq('id', id);
  if (error) throw error;
};

/** So a photo taken on the phone shows up on the board without a refresh. */
export const subscribeToTicketPhotos = (onChange: () => void) => {
  const channel = getClient()
    .channel(`garage-ticket-photos-${++channelSeq}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'ticket_photos' }, onChange)
    .subscribe();
  return () => void getClient().removeChannel(channel);
};

/* ---------------- realtime ---------------- */

/* Each subscriber gets its own channel name. Supabase reuses a channel by its
   topic, and adding `.on(...)` to an already-subscribed channel throws — so two
   components watching the same table must not share a channel name. */
let channelSeq = 0;

/** Fires `onChange` whenever anyone, anywhere, touches a ticket / work / part. */
export const subscribeToTickets = (onChange: () => void) => {
  const channel = getClient()
    .channel(`garage-tickets-${++channelSeq}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tickets' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'works' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'work_items' }, onChange)
    .subscribe();
  return () => void getClient().removeChannel(channel);
};

/** Same, for the catalog-ish tables an app lists on a screen of its own. */
export const subscribeToTable = (
  table: 'customers' | 'items' | 'vehicles' | 'garage_workers' | 'work_defs',
  onChange: () => void,
) => {
  const channel = getClient()
    .channel(`garage-${table}-${++channelSeq}`)
    .on('postgres_changes', { event: '*', schema: 'public', table }, onChange)
    .subscribe();
  return () => void getClient().removeChannel(channel);
};
