// Bundles the breakpoint start-model migration (src/code/project/breakpoint-project-migration.ts)
// into ONE Node ESM file for the backend's migrate-breakpoints.mjs:
//   node_modules/.bin/rolldown -c breakpoint-migration.rolldown.config.mjs
// Output: ../backend/breakpoint-migration.bundle.mjs (a build artifact — never commit it).
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));

export default {
  input: path.join(root, 'src/code/project/breakpoint-project-migration.ts'),
  platform: 'node',
  resolve: { alias: { '@': path.join(root, 'src') } },
  transform: { define: { 'import.meta.env': JSON.stringify({ MODE: 'production', DEV: false, PROD: true, SSR: true }) } },
  output: { file: path.join(root, '../backend/breakpoint-migration.bundle.mjs'), format: 'esm', codeSplitting: false },
};
