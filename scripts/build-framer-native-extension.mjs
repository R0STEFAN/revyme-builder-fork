import { mkdir, copyFile, readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, join } from 'node:path';

const root = fileURLToPath(new URL('../extensions/framer-native/', import.meta.url));
const files = ['manifest.json', 'popup.html', 'popup.css', 'popup.mjs', 'transport.mjs',
  'page-reader.mjs', 'capture.mjs', 'source-adapters.mjs', 'README.md'];

export async function buildNativeReader(output) {
  const directory = resolve(output);
  if (directory === resolve(root)) throw new Error('Build output must differ from the extension source.');
  await mkdir(directory, { recursive: true });
  for (const name of files) await copyFile(join(root, name), join(directory, name));
  await copyFile(fileURLToPath(new URL('../src/shared/framer-transfer-envelope.mjs', import.meta.url)), join(directory, 'envelope.mjs'));
  const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
  return { directory, version: manifest.version, files: [...files, 'envelope.mjs'] };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const output = process.argv[2];
  if (!output) throw new Error('Usage: node scripts/build-framer-native-extension.mjs <output-directory>');
  console.log(JSON.stringify(await buildNativeReader(output), null, 2));
}
