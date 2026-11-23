/* The local admin console. `npm run admin` — never built, never deployed.
 *
 * It is not in the root vite.config.ts inputs, so `npm run build` (and with it
 * Netlify) does not know this folder exists. Keep it that way: the API below
 * holds service_role keys for every environment, and the only thing standing
 * between them and the internet is that this server binds to 127.0.0.1.
 */

import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { adminApi } from './server/api.ts';

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  root: here('.'),
  /* Vite loads .env* from the root it is given; pointing it at a folder with no
     env files means no VITE_ variable — the app's or anybody's — can be baked
     into this page. The keys are read by the server side only. */
  envDir: here('./no-env'),
  /* Its own dependency cache, so running the console beside `npm run dev`
     does not make the two re-optimize each other's dependencies. */
  cacheDir: here('../node_modules/.vite-admin'),
  plugins: [react(), adminApi()],
  server: {
    host: '127.0.0.1',
    port: 4180,
    strictPort: true,
    open: true,
    /* Vite would otherwise serve any file under the repo root to the page —
       including the gitignored customer exports in scripts/ricbi. The page
       needs this folder, the libraries, the app's src/ (its components, styles
       and locale — no secrets live there), and the two files of packages/ops
       that are free of Node. */
    fs: {
      strict: true,
      allow: [
        here('.'),
        here('../node_modules'),
        here('../src'),
        here('../packages/ops/src/types.ts'),
        here('../packages/ops/src/onboarding/rules.ts'),
      ],
    },
  },
  preview: { host: '127.0.0.1' },
});
