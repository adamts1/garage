/* Money, written the same way everywhere.

   There were nineteen copies of this across the two apps — most called `shekel`,
   some `money`, and they were not the same function: ten forced two decimals,
   eight showed agorot only when there were any, one rounded, and one put the ₪
   after the number instead of before. Which one a screen got was an accident of
   which file it was copied from, so the same total read as ₪1,180 on the board
   and ₪1,180.00 on the ticket.

   Three deliberate forms remain, and choosing between them is a decision about
   the reader rather than about the number. */

const HEBREW = 'he-IL';

/** ₪1,234.50 — always agorot. Anything a customer is quoted, invoiced or signs. */
export const money = (n: number): string =>
  '₪' + n.toLocaleString(HEBREW, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** ₪1,234.5 — agorot only when there are any. Lists and boards, where a column
    of round numbers reads better without a wall of trailing zeroes. */
export const shekel = (n: number): string => '₪' + n.toLocaleString(HEBREW);

/** ₪1,235 — no agorot at all. Summary tiles, where the agorot are noise. */
export const shekelRounded = (n: number): string =>
  '₪' + Math.round(n).toLocaleString(HEBREW);
