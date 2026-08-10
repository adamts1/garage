import { payMethod } from '@garage/shared';
import type { TFunction } from 'i18next';

/* What the OPERATOR reads where a stored payment method is shown — the ticket's
   billing card, an invoice's detail, the toast that confirms money was taken.
   The column holds a code (see packages/shared/src/payment.ts); this is the one
   place that turns one into words, so a locale file is the only thing that has
   to change when the words do.

   Rows written before the migration hold Hebrew, and imports may hold something
   the vocabulary has no code for at all. Those come back as themselves rather
   than as `payMethods.כרטיס אשראי` on screen. */
export function payMethodLabel(t: TFunction, raw: string | null | undefined): string | null {
  const code = payMethod(raw);
  if (code) return t(`payMethods.${code}`);
  return (raw ?? '').trim() || null;
}
