import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/services/google-sign-in.test.ts'],
  },
});
