import { describe, expect, it } from 'vitest';
import he from './locales/he.json';

/* A missing key is not a crash — i18next renders the key itself, so the screen
   quietly says "ticket.fields.plate" to a mechanic. Nothing else here would
   notice, and neither would a typecheck.

   This reads the app's sources for keys written as literals and checks each one
   resolves. Keys built at runtime — t(`create.required.${field}`) — cannot be
   read statically and are not covered; the one helper that builds those returns
   a union of the field names instead, so the compiler covers it.

   The mirror of src/i18n/keys.test.ts in the web app. */

const sources = import.meta.glob('../{app,components,lib}/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

function flatten(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return [prefix];
  return Object.entries(value).flatMap(([k, v]) => flatten(v, prefix ? `${prefix}.${k}` : k));
}

const known = new Set(flatten(he));

/* Matching on call sites — t('x') — misses most of the real usage: keys live
   inside ternaries, arrays and object values just as often as directly inside
   t(). So instead: any quoted literal beginning with one of he.json's own
   top-level namespaces is a key, wherever it appears.

   Quoted only, so `create.required.${field}` is skipped rather than matched
   down to a half key. */
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
    expect(known.size).toBeGreaterThan(100);
    expect(usedKeys().size).toBeGreaterThan(80);
  });

  it('leaves no Hebrew literal in the code itself', () => {
    /* The point of the exercise: copy lives in he.json, not in a .tsx file.

       No exemptions. The Hebrew that is *data* rather than copy — the flags and
       defaults written into a ticket, the customer kind, the message sent to a
       customer — lives in @garage/shared, where both apps read one definition
       and neither app's language setting can change it.

       Comments are stripped first: explaining a rule usually means quoting the
       Hebrew it is about, and a comment ships to no one. */
    const HEBREW = /[֐-׿]/;

    const stripComments = (text: string) =>
      text
        .replace(/\/\*[\s\S]*?\*\//g, '')
        // Not preceded by a colon, so the // in an https:// URL survives.
        .replace(/(^|[^:])\/\/.*$/gm, '$1');

    const offenders = Object.entries(sources)
      .filter(([file]) => !/\.test\.tsx?$/.test(file))
      .filter(([, text]) => HEBREW.test(stripComments(text)))
      .map(([file]) => file);

    expect(offenders).toEqual([]);
  });
});
