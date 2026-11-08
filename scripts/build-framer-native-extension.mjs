import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, join } from 'node:path';
import esbuild from 'esbuild';

const root = fileURLToPath(new URL('../extensions/framer-native/', import.meta.url));
const files = ['manifest.json', 'popup.html', 'popup.css', 'popup.mjs', 'transport.mjs',
  'page-reader.mjs', 'capture.mjs', 'source-adapters.mjs', 'README.md'];

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function writeArchive(directory, names) {
  const local = [];
  const central = [];
  let offset = 0;
  for (const name of names) {
    const filename = Buffer.from(name);
    const bytes = await readFile(join(directory, name));
    if (filename.length > 0xffff || bytes.length > 0xffffffff) throw new Error('Extension archive entry is too large.');
    const checksum = crc32(bytes);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x0800, 6);
    header.writeUInt16LE(33, 12); // 1980-01-01, the oldest ZIP timestamp
    header.writeUInt32LE(checksum, 14);
    header.writeUInt32LE(bytes.length, 18);
    header.writeUInt32LE(bytes.length, 22);
    header.writeUInt16LE(filename.length, 26);
    local.push(header, filename, bytes);

    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE(20, 4);
    record.writeUInt16LE(20, 6);
    record.writeUInt16LE(0x0800, 8);
    record.writeUInt16LE(33, 14);
    record.writeUInt32LE(checksum, 16);
    record.writeUInt32LE(bytes.length, 20);
    record.writeUInt32LE(bytes.length, 24);
    record.writeUInt16LE(filename.length, 28);
    record.writeUInt32LE(offset, 42);
    central.push(record, filename);
    offset += header.length + filename.length + bytes.length;
  }
  if (names.length > 0xffff || offset > 0xffffffff) throw new Error('Extension archive is too large.');
  const centralBytes = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(names.length, 8);
  end.writeUInt16LE(names.length, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  const archive = `${directory}.zip`;
  await writeFile(archive, Buffer.concat([...local, centralBytes, end]));
  return archive;
}

export async function buildNativeReader(output) {
  const directory = resolve(output);
  if (directory === resolve(root)) throw new Error('Build output must differ from the extension source.');
  await mkdir(directory, { recursive: true });

  // Ensure envelope.mjs exists in both source and output
  const envelopeSource = fileURLToPath(new URL('../src/shared/framer-transfer-envelope.mjs', import.meta.url));
  await copyFile(envelopeSource, join(directory, 'envelope.mjs'));
  await copyFile(envelopeSource, join(root, 'envelope.mjs'));

  for (const name of files) await copyFile(join(root, name), join(directory, name));

  // Bundle normalizer for clean browser execution without Node globals
  await esbuild.build({
    entryPoints: [fileURLToPath(new URL('../src/code/import/framer-native/normalizer.ts', import.meta.url))],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    define: {
      'process.env.NODE_ENV': '"production"',
      'process.env.BABEL_TYPES_8_BREAKING': 'false',
      'process.env': '{}',
      'global': 'window',
    },
    outfile: join(directory, 'normalizer.mjs'),
  });
  await copyFile(join(directory, 'normalizer.mjs'), join(root, 'normalizer.mjs'));

  const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
  const packagedFiles = [...files, 'envelope.mjs', 'normalizer.mjs'];
  const archive = await writeArchive(directory, packagedFiles);
  return { directory, archive, version: manifest.version, files: packagedFiles };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const output = process.argv[2];
  if (!output) throw new Error('Usage: node scripts/build-framer-native-extension.mjs <output-directory>');
  console.log(JSON.stringify(await buildNativeReader(output), null, 2));
}
