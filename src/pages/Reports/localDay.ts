/** A Date as YYYY-MM-DD in the reader's own timezone.
 *
 *  NOT `toISOString().slice(0, 10)`, which is the obvious thing and is wrong
 *  everywhere east of Greenwich: it converts to UTC first, so local midnight on
 *  1 January in Israel is 21:00 on 31 December in UTC, and a year that should
 *  start on the 1st starts on the 31st of the month before. The tests caught it
 *  on `presetRange('thisYear')`, and the same slip in `today()` would have made
 *  every report think it was yesterday for the last three hours of every day.
 *
 *  Every date in these reports is a calendar day in the garage's own reckoning —
 *  a document issued at 23:40 belongs to that evening, not to tomorrow — so the
 *  local components are the right ones to read. */
export const localDay = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Today, as the garage would write it. */
export const today = (): string => localDay(new Date());
