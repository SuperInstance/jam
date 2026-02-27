import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import renderer from 'vite-plugin-electron-renderer';
import { builtinModules } from 'module';
import path from 'path';

// Node builtins + native modules that should not be bundled
const external = [
  'electron',
  ...builtinModules,
  ...builtinModules.map((m) => `node:${m}`),
  'node-pty',
  'electron-store',
];

export default defineConfig({
  plugins: [
    react(),
    electron([
      {
        entry: 'electron/main.ts',
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              external,
              output: {
                inlineDynamicImports: true,
              },
            },
          },
          resolve: {
            alias: {
              '@jam/core': path.resolve(__dirname, '../../packages/core/src'),
              '@jam/eventbus': path.resolve(__dirname, '../../packages/eventbus/src'),
              '@jam/agent-runtime': path.resolve(__dirname, '../../packages/agent-runtime/src'),
              '@jam/voice': path.resolve(__dirname, '../../packages/voice/src'),
              '@jam/memory': path.resolve(__dirname, '../../packages/memory/src'),
              '@jam/team': path.resolve(__dirname, '../../packages/team/src'),
              '@jam/sandbox': path.resolve(__dirname, '../../packages/sandbox/src'),
            },
          },
        },
      },
      {
        entry: 'electron/preload.ts',
        onstart(options) {
          options.reload();
        },
      },
    ]),
    renderer(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    outDir: 'dist',
  },
});
