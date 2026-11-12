/* Finding a known customer from the counter-sale dialog's own fields.
 *
 * A counter sale is usually for someone the garage has seen before, so the
 * name, phone and plate fields each search what is on file and offer to fill
 * the rest. Each offer is one customer with one car: someone with two cars is
 * two offers, because which car the sale is for is exactly what the plate
 * field needs to know. */

import {
  phoneDigits, plateKey, searchCustomers,
  type CustomerWithVehicles, type Vehicle,
} from '@garage/shared';
import { useEffect, useMemo, useState } from 'react';
import { isConfigured } from '../../lib/supabase';
import { useDebouncedValue } from '../../lib/useDebouncedValue';

/** 'any' is the search box above the fields: a name, a phone or a plate,
 *  whichever it turns out to be. */
export type LookupField = 'name' | 'phone' | 'plate' | 'any';

export interface LookupOption {
  key: string;
  customer: CustomerWithVehicles;
  /** Null for a customer with no car on file. */
  vehicle: Vehicle | null;
}

/** How many offers the list shows. */
export const LOOKUP_LIMIT = 8;

/* Below these, a query is a fragment of half the garage. */
const MIN_NAME = 2;
const MIN_DIGITS = 3;
const MIN_PLATE = 3;

const perCar = (c: CustomerWithVehicles): LookupOption[] =>
  c.vehicles?.length
    ? c.vehicles.map((v) => ({ key: `${c.id}:${v.id}`, customer: c, vehicle: v }))
    : [{ key: c.id, customer: c, vehicle: null }];

/** The offers for what was typed into `field`, out of the customers the
 *  server returned. Pure, so the matching can be tested without a database. */
export function lookupOptions(
  found: readonly CustomerWithVehicles[],
  field: LookupField,
  query: string,
): LookupOption[] {
  const q = query.trim();
  if (field === 'any') {
    /* A plate first: a car is the most specific thing that can match. Then
       phone, then name, each customer-and-car once. */
    const seen = new Set<string>();
    return (['plate', 'phone', 'name'] as const)
      .flatMap((f) => lookupOptions(found, f, q))
      .filter((o) => (seen.has(o.key) ? false : (seen.add(o.key), true)))
      .slice(0, LOOKUP_LIMIT);
  }
  let out: LookupOption[] = [];
  if (field === 'name') {
    if (q.length < MIN_NAME) return [];
    const lower = q.toLowerCase();
    out = found.filter((c) => c.name.toLowerCase().includes(lower)).flatMap(perCar);
  } else if (field === 'phone') {
    const digits = phoneDigits(q);
    if (digits.length < MIN_DIGITS) return [];
    out = found.filter((c) => phoneDigits(c.phone).includes(digits)).flatMap(perCar);
  } else {
    const key = plateKey(q);
    if (key.length < MIN_PLATE) return [];
    /* Only the car that matched, not the owner's others. */
    out = found.flatMap((c) =>
      (c.vehicles ?? [])
        .filter((v) => plateKey(v.plate).includes(key))
        .map((v) => ({ key: `${c.id}:${v.id}`, customer: c, vehicle: v })),
    );
  }
  return out.slice(0, LOOKUP_LIMIT);
}

/** The offers for the field being typed in, asked of the server once typing
 *  pauses. A late reply to an older query is dropped. */
export function useCounterSaleLookup(field: LookupField | null, query: string): LookupOption[] {
  const settled = useDebouncedValue(field ? `${field}\u0000${query.trim()}` : '');
  const [answer, setAnswer] = useState<{ key: string; rows: CustomerWithVehicles[] }>({ key: '', rows: [] });

  useEffect(() => {
    if (!isConfigured || !settled) return;
    const q = settled.split('\u0000')[1];
    if (!q) return;
    let alive = true;
    /* The phone is sent as digits: the database matches a phone by its
       digits, and "050-123" would otherwise look for the hyphen. */
    const numeric = /^[\d\s\-+()]+$/.test(q);
    const asked = settled.startsWith('phone') || (settled.startsWith('any') && numeric) ? phoneDigits(q) : q;
    searchCustomers({ query: asked, pageSize: 20 })
      .then((p) => { if (alive) setAnswer({ key: settled, rows: p.rows }); })
      .catch(() => {});
    return () => { alive = false; };
  }, [settled]);

  return useMemo(
    () => (field && answer.key === settled ? lookupOptions(answer.rows, field, query) : []),
    [answer, settled, field, query],
  );
}
