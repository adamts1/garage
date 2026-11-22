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
import { adminApi } from './server/api.mjs';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  /* Vite loads .env* from the root it is given; pointing it at a folder with no
     env files means no VITE_ variable — the app's or anybody's — can be baked
     into this page. The keys are read by the server side only. */
  envDir: fileURLToPath(new URL('./no-env', import.meta.url)),
  /* Its own dependency cache, so running the console beside `npm run dev`
     does not make the two re-optimize each other's dependencies. */
  cacheDir: fileURLToPath(new URL('../node_modules/.vite-admin', import.meta.url)),
  plugins: [react(), adminApi()],
  server: {
    host: '127.0.0.1',
    port: 4180,
    strictPort: true,
    open: true,
    /* Vite would otherwise serve any file under the repo root to the page —
       including the gitignored customer exports in scripts/ricbi. This folder
       and the installed libraries are all the page needs. */
    fs: {
      strict: true,
      allow: [
        fileURLToPath(new URL('.', import.meta.url)),
        fileURLToPath(new URL('../node_modules', import.meta.url)),
      ],
    },
  },
  preview: { host: '127.0.0.1' },
});
