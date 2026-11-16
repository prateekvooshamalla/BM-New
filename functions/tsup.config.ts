import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs'],
  outDir: 'lib',
  clean: true,
  platform: 'node',
  target: 'node22',
  // These packages live outside the Functions upload directory.
  noExternal: [/^@bharat-makaan\//],
  external: ['firebase-admin', 'firebase-functions'],
});
