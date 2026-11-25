import { describe, expect, it } from 'vitest';
import consoleHe from './he.json';

/* The same check the app runs on its own locale (src/i18n/keys.test.ts): every
   console.* key written as a literal in the console's source must exist, or the
   page shows the raw key. Keys built at runtime — t(`console.software.${s}`) —
   are not covered; their unions are checked by the compiler instead. */
const sources = import.meta.glob('../**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

function flatten(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return [prefix];
  return Object.entries(value).flatMap(([k, v]) => flatten(v, prefix ? `${prefix}.${k}` : k));
}

const known = new Set(flatten(consoleHe));
const KEY_LITERAL = /['"](console(?:\.[\w-]+)+)['"]/g;

describe('console translation keys', () => {
  it('every console.* key used in the source exists in he.json', () => {
    const missing: string[] = [];
    for (const [file, text] of Object.entries(sources)) {
      if (/\.test\.tsx?$/.test(file)) continue;
      for (const [, key] of text.matchAll(KEY_LITERAL)) {
        if (key && !known.has(key)) missing.push(`${key}  (${file})`);
      }
    }
    expect(missing).toEqual([]);
  });
});
