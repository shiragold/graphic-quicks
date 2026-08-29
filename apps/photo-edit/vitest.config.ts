import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // setupFiles run inside each worker, so globalThis.cv set here is visible
    // to test files. (globalSetup runs in the main process only.)
    setupFiles: ['./tests/setup.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
