/** dd.mm.yyyy, or a dash. */
export const formatDate = (v: string | number | null | undefined): string =>
  v == null || v === ''
    ? '—'
    : new Date(v).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' });

/** 20261124090000 → 24.11.2026 09:00, for reading a migration version at a glance. */
export const formatVersion = (v: string): string =>
  `${v.slice(6, 8)}.${v.slice(4, 6)}.${v.slice(0, 4)} ${v.slice(8, 10)}:${v.slice(10, 12)}`;
