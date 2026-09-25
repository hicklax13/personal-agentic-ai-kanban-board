import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: { '@shared': resolve(__dirname, 'shared') },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Each suite writes into its own temp dir, so parallel files are safe.
    reporters: ['verbose'],
  },
});
