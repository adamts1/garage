import { describe, expect, it } from 'vitest';
import he from './locales/he.json';

/* A missing key is not a crash — i18next renders the key itself, so the screen
   quietly says "workers.fields.colour" to a mechanic. Nothing else in the suite
   would notice, and neither would a typecheck.

   This reads the source for keys written as literals and checks each one
   resolves. Keys built at runtime — t(`workers.fields.${field}`) — cannot be
   read statically and are not covered; the helpers that build those take a
   union of the labelled field names instead, so the compiler covers them.

   Sources come from import.meta.glob rather than node:fs, so the test needs no
   node types in a tsconfig that is otherwise DOM-only. */
const sources = import.meta.glob('../**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

function flatten(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return [prefix];
  return Object.entries(value).flatMap(([k, v]) => flatten(v, prefix ? `${prefix}.${k}` : k));
}

const known = new Set(flatten(he));

/* Matching on call sites — t('x'), label="x" — turned out to miss most of the
   real usage: keys live inside ternaries, arrays and object values just as
   often as directly inside t(). So instead: any quoted literal that begins with
   one of he.json's own top-level namespaces is a key, wherever it appears.

   Quoted only, so `workers.fields.${field}` is skipped rather than matched down
   to a half key. */
const namespaces = Object.keys(he).join('|');
const KEY_LITERAL = new RegExp(`['"]((?:${namespaces})(?:\\.[\\w]+)+)['"]`, 'g');

function usedKeys() {
  const found = new Map<string, string>();
  for (const [file, text] of Object.entries(sources)) {
    if (/\.test\.tsx?$/.test(file)) continue;
    for (const [, key] of text.matchAll(KEY_LITERAL)) found.set(key, file);
  }
  return found;
}

describe('translation keys', () => {
  it('every key used in the source exists in he.json', () => {
    const missing = [...usedKeys()]
      .filter(([key]) => !known.has(key))
      .map(([key, file]) => `${key}  (${file})`);

    expect(missing).toEqual([]);
  });

  it('reads real sources, so the check above cannot pass vacuously', () => {
    expect(known.size).toBeGreaterThan(50);
    expect(usedKeys().size).toBeGreaterThan(30);
  });
});
