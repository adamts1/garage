import react from '@vitejs/plugin-react';
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 4173,
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
