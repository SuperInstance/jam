import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  test: {
    include: ['electron/**/*.test.ts', 'src/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['electron/**/*.ts', 'src/**/*.ts'],
      exclude: ['electron/main.ts', 'electron/preload.ts', 'electron/**/*.test.ts', 'src/**/*.test.ts'],
    },
  },
});
