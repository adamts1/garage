import react from '@vitejs/plugin-react';
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 4173,
  },
  build: {
    rollupOptions: {
      output: {
        /* The large libraries each get a chunk of their own. In one bundle,
           every deploy renamed the whole thing, and the first load after any
           change downloaded React and Supabase again. A library chunk keeps its
           hash — and, with the immutable header in public/_headers, its cache —
           until that library is upgraded. */
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'react';
          if (/node_modules\/(react-router|react-router-dom|@remix-run)\//.test(id)) return 'router';
          if (id.includes('node_modules/@supabase/')) return 'supabase';
          if (id.includes('node_modules/@sentry')) return 'sentry';
          if (/node_modules\/(i18next|react-i18next)\//.test(id)) return 'i18n';
          return 'vendor';
        },
      },
    },
  },
  test: {
    /* Runs before every test file. It blocks fetch, WebSocket and
       XMLHttpRequest, and refuses the run outright if the environment names the
       production project — so no test can reach a real database, and in
       particular none can issue a tax document at a garage's provider. See the
       file itself for why that is worth enforcing rather than assuming. */
    setupFiles: ['./src/test/no-network.ts'],
    /* `mobile/` is a separate npm project — its own package.json, its own
       vitest, its own CI job. Its tsconfig extends `expo/tsconfig.base`, which
       exists only under mobile/node_modules, so a root run that globs into it
       fails to transform a single file the moment mobile's dependencies are not
       installed. That is every run of the web job, which installs only the root.

       Excluded rather than made to work: the two suites are not one suite. The
       mobile job runs them, against the dependencies they are written for. */
    exclude: [...configDefaults.exclude, 'mobile/**'],
  },
});
