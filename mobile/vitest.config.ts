import { defineConfig } from 'vitest/config';

/* The mobile suite had no config of its own — the defaults were right and there
   was nothing to say. There is now: a setup file that blocks the network, so no
   test here can write into a real garage's data. See test/no-network.ts. */
export default defineConfig({
  test: {
    setupFiles: ['./test/no-network.ts'],
  },
});
