import { describe, expect, it } from 'vitest';

/* No hook below an early return.
 *
 * A screen refused to open with "Rendered more hooks than during the previous
 * render", and the cause was one `useState` written next to the function that
 * used it — which happened to be below the component's `if (!draft) return null`.
 * The count of hooks then differs between the render that bails out and the one
 * that does not, and React cannot match them up.
 *
 * TypeScript cannot see this and there is no ESLint here, so nothing did. This
 * is the cheapest thing that can: a scan of the sources, in the same spirit as
 * lib/i18n.test.ts, which reads them to check every key resolves.
 *
 * The rule is deliberately about THIS codebase's shape rather than about
 * JavaScript in general: components are top-level functions whose body is
 * indented two spaces, so a `return` at exactly two spaces is the component
 * bailing out, and a `use…()` at exactly two spaces is a hook in its body. A
 * nested helper's body is indented four or more and is not matched. That makes
 * the check readable and its failures obvious; it is not a substitute for the
 * real lint rule if one is ever added.
 */

const sources = import.meta.glob('../{app,components,lib}/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** `  return …` or `  if (…) return …` — the component giving up on this render. */
const EARLY_RETURN = /^ {2}(if \(.*\) )?return\b/;
/** `  const [a, b] = useState(…)` / `  const x = useMemo(…)` — a hook in the body. */
const HOOK_CALL = /^ {2}(const|let)\s.*=\s*use[A-Z]\w*\(/;

/** Every hook that a render could skip past, per file. */
const hooksAfterEarlyReturn = (src: string): string[] => {
  const lines = src.split('\n');
  const found: string[] = [];
  let bailedOut = false;
  for (const [i, line] of lines.entries()) {
    /* Anything starting in column zero is outside a two-space body — the
       closing brace of one function, or the declaration of the next. Either way
       the previous body's returns say nothing about what follows.

       This is the reset, and it has to be this rather than "a line beginning
       with `function`": half the components here are `export const X = () => {`,
       and matching only the keyword let one file's final return leak into the
       next arrow function and flag its first hook. */
    if (/^\S/.test(line)) bailedOut = false;
    if (EARLY_RETURN.test(line)) bailedOut = true;
    if (bailedOut && HOOK_CALL.test(line)) found.push(`${i + 1}: ${line.trim()}`);
  }
  return found;
};

describe('hooks run on every render', () => {
  it.each(Object.keys(sources))('%s declares no hook below an early return', (file) => {
    expect(hooksAfterEarlyReturn(sources[file])).toEqual([]);
  });
});

/* The check has to be able to fail, or it is decoration. This is the shape of
   the bug it was written for. */
describe('the check itself', () => {
  it('catches a hook below an early return', () => {
    const bad = [
      'export default function Screen() {',
      '  const [a, setA] = useState(1);',
      '  if (!a) return null;',
      '  const [b, setB] = useState(2);',
      '}',
    ].join('\n');
    expect(hooksAfterEarlyReturn(bad)).toHaveLength(1);
  });

  it('leaves a hook above the early return alone', () => {
    const good = [
      'export default function Screen() {',
      '  const [a, setA] = useState(1);',
      '  const [b, setB] = useState(2);',
      '  if (!a) return null;',
      '}',
    ].join('\n');
    expect(hooksAfterEarlyReturn(good)).toEqual([]);
  });

  /* Two components in one file: the first one's return must not condemn the
     second one's hooks — including when both are arrow functions, which is how
     TicketsProvider is written and what the first draft of this check got
     wrong. */
  it('starts afresh at the next function', () => {
    const twoComponents = [
      'export const A = () => {',
      '  return <X />;',
      '};',
      'export const B = () => {',
      '  const store = useContext(C);',
      '};',
    ].join('\n');
    expect(hooksAfterEarlyReturn(twoComponents)).toEqual([]);
  });

  /* A component's own final return is at the same indentation as an early one.
     Nothing follows it inside the body, so it must not be treated as a bail. */
  it('is not upset by the last return in a component', () => {
    const normal = [
      'export default function Screen() {',
      '  const [a, setA] = useState(1);',
      '  return <View />;',
      '}',
      'function Helper() {',
      '  const [b, setB] = useState(2);',
      '}',
    ].join('\n');
    expect(hooksAfterEarlyReturn(normal)).toEqual([]);
  });
});
