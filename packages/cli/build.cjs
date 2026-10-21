// packages/cli/build.cjs
const esbuild = require('esbuild');
const path = require('node:path');

try {
  esbuild.buildSync({
    entryPoints: [path.join(__dirname, 'src/main.ts')],
    outfile: path.join(__dirname, 'dist/main.js'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    alias: {
      '@': path.resolve(__dirname, '../../src'),
      '@revyme/automation-core': path.resolve(__dirname, '../automation-core/src/index.ts'),
    },
    external: [
      '@modelcontextprotocol/sdk',
      '@modelcontextprotocol/sdk/*',
      'zod',
      '@babel/*',
    ],
  });
  console.log('CLI build complete: dist/main.js');
} catch (err) {
  console.error('CLI build failed:', err);
  process.exit(1);
}
