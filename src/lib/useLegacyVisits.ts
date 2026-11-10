import { legacyVisits } from '@garage/shared';
import { useEffect, useState } from 'react';
import { isConfigured } from './supabase';

type Visit = Awaited<ReturnType<typeof legacyVisits>>[number];

/** When the cars (or customers) on one page of a list came in under the
 *  previous system — the imported cards, which the board's list leaves out —
 *  so the list's counts include them. One small query per page shown. */
export function useLegacyVisits(by: 'car' | 'customer', ids: readonly string[]): Visit[] {
  const [visits, setVisits] = useState<Visit[]>([]);
  const key = ids.join(',');
  useEffect(() => {
    if (!isConfigured || !key) { setVisits([]); return; }
    let alive = true;
    const list = key.split(',');
    legacyVisits(by === 'car' ? { carIds: list } : { customerIds: list })
      .then((v) => alive && setVisits(v))
      .catch(() => {});
    return () => { alive = false; };
  }, [by, key]);
  return visits;
}
