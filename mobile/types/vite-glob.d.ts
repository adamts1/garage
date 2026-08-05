/* `import.meta.glob` is a Vite feature, and vitest runs on Vite — so the keys
   test can read the app's own sources without node:fs.

   Only the one signature it uses is declared. Referencing vite/client wholesale
   would pull in its `declare module '*.png'` assertions, which collide with the
   ones Expo already provides. */

interface ImportMeta {
  glob(
    pattern: string,
    options: { query: '?raw'; import: 'default'; eager: true },
  ): Record<string, string>;
}
