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

test('emits a repeatable installable archive containing only reader files', async () => {
  const output = await mkdtemp(join(tmpdir(), 'framer-reader-archive-'));
  try {
    const first = await buildNativeReader(join(output, 'first'));
    const second = await buildNativeReader(join(output, 'second'));
    assert.deepEqual(await readFile(first.archive), await readFile(second.archive));
    const archive = await readFile(first.archive);
    for (const name of first.files) assert.ok(archive.includes(Buffer.from(name)), `${name} missing from archive`);
    assert.ok(!archive.includes(Buffer.from('user-notes.txt')));
  } finally { await rm(output, { recursive: true, force: true }); }
});
