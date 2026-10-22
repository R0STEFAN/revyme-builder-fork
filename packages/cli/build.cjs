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
    banner: {
      js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
    },
    footer: {
      js: `if (!globalThis.__REVYME_CLI_RAN__ && process.argv[1]) {
  try {
    const _p = require('node:path');
    const _u = require('node:url');
    if (_u.fileURLToPath(import.meta.url) === _p.resolve(process.argv[1])) {
      globalThis.__REVYME_CLI_RAN__ = true;
      runCli().then((code) => {
        if (code !== 0) process.exit(code);
      });
    }
  } catch {}
}`,
    },
    alias: {
      '@': path.resolve(__dirname, '../../src'),
      '@revyme/automation-core': path.resolve(__dirname, '../automation-core/src/index.ts'),
    },
    define: {
      'import.meta.env.DEV': 'false',
      'import.meta.env.MODE': '"production"',
      'import.meta.env.BASE_URL': '"/"',
      'import.meta.env.VITE_GOOGLE_FONTS_KEY': '""',
      'import.meta.env.VITE_REVYME_CLOUD': '"false"',
      'import.meta.env.VITE_CDN_HOST': '"https://assets.revyme.app"',
      'import.meta.env.VITE_AI_SERVICE_URL': '""',
      'import.meta.env.VITE_PREVIEW_HOST': '""',
      'import.meta.env.VITE_PIXABAY_KEY': '""',
      'import.meta.env.VITE_UNSPLASH_ACCESS_KEY': '""',
      'import.meta.env.VITE_IMPORT_SERVICE_URL': '""',
      'import.meta.env.VITE_API_URL': '""',
      'import.meta.env': '{}',
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
