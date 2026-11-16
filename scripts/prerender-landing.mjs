/* Runs after `vite build` (see the "build" script): renders the landing page
   for each language and writes the markup into the built HTML files, in place
   of the empty <div id="root">. Without this, Google sees an empty page until
   it gets round to running the bundle, which it does late and not always. */

import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'vite';

const root = fileURLToPath(new URL('..', import.meta.url));
const ssrOut = `${root}dist-ssr`;

await build({
  root,
  logLevel: 'warn',
  build: { ssr: 'src/pages/Landing/prerender.tsx', outDir: ssrOut, emptyOutDir: true },
});

const { render } = await import(pathToFileURL(`${ssrOut}/prerender.js`).href);

const PAGES = { he: 'dist/marketing/index.html', ar: 'dist/marketing/ar/index.html' };
const EMPTY_ROOT = '<div id="root"></div>';

for (const [lang, file] of Object.entries(PAGES)) {
  const path = `${root}${file}`;
  const html = readFileSync(path, 'utf8');
  if (!html.includes(EMPTY_ROOT)) throw new Error(`${file}: no empty ${EMPTY_ROOT} to fill`);
  writeFileSync(path, html.replace(EMPTY_ROOT, `<div id="root">${render(lang)}</div>`));
  console.log(`prerendered ${file}`);
}

rmSync(ssrOut, { recursive: true, force: true });
