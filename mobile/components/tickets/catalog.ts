/* The rules the two catalog pickers share.

   Not in components/ui: what counts as a code rather than a name is a decision
   about this garage's catalogs, and the web modals make the same one. */

import { toCatalogCode } from '@garage/shared';

/** A fresh work uid. Kept here so both forms mint ids the same way. */
export const workUid = () => `w-${Date.now()}-${Math.floor(Math.random() * 1e4)}`;

/* What was typed into the search box seeds the create form: 'EXH-01' is plainly
   a code, 'החלפת מצת' plainly a name. Same rule as the web modals, so a mechanic
   who uses both does not have to relearn it — including what a code may contain,
   which is @garage/shared's toCatalogCode and not this file's own opinion. */
export function seedFromQuery(query: string): { code: string; name: string } {
  const typed = query.trim();
  const looksLikeCode = /^[A-Za-z0-9\-_]+$/.test(typed);
  return { code: looksLikeCode ? toCatalogCode(typed) : '', name: looksLikeCode ? '' : typed };
}
