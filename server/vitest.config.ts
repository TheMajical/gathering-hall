import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/__tests__/**/*.test.ts'],
    testTimeout: 120_000,
    // Socket servers bind real ports; keep runs isolated.
    pool: 'forks',
  },
});
