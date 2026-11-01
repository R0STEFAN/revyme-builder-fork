import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildNativeReader } from '../../../scripts/build-framer-native-extension.mjs';

test('packages a standalone extension with the same validated transfer decoder', async () => {
  const output = await mkdtemp(join(tmpdir(), 'framer-reader-build-'));
  try {
    await writeFile(join(output, 'user-notes.txt'), 'keep');
    await buildNativeReader(output);
    const manifest = JSON.parse(await readFile(join(output, 'manifest.json'), 'utf8'));
    await access(join(output, manifest.action.default_popup));
    for (const group of manifest.web_accessible_resources) for (const file of group.resources) await access(join(output, file));
    const { decodeNativeTransfer } = await import(pathToFileURL(join(output, 'envelope.mjs')).href);
    assert.throws(() => decodeNativeTransfer({ format: 'other', version: 1 }));
    assert.equal(await readFile(join(output, 'user-notes.txt'), 'utf8'), 'keep');
  } finally { await rm(output, { recursive: true, force: true }); }
});
