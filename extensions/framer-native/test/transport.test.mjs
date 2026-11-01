import test from 'node:test';
import assert from 'node:assert/strict';
import { captureTabSource } from '../transport.mjs';

test('rejects non-editor tabs before attempting any injection', async () => {
  await assert.rejects(captureTabSource({}, { id: 4, url: 'https://example.com/' }, { mode: 'page' }), /FRAMER_EDITOR_REQUIRED/);
});

test('only accepts a complete response from the requested top frame', async () => {
  const api = { runtime: { getURL: name => `chrome-extension://test/${name}` },
    scripting: { async executeScript() { return [{ frameId: 3, result: { ok: true, transfer: {} } }]; } } };
  await assert.rejects(captureTabSource(api, { id: 4, url: 'https://framer.com/projects/Example--project-abc' }, { mode: 'page' }), /CAPTURE_RESPONSE_INVALID/);
});

test('surfaces the reader error instead of returning an empty successful export', async () => {
  const api = { runtime: { getURL: name => `chrome-extension://test/${name}` },
    scripting: { async executeScript() { return [{ frameId: 0, result: { ok: false, error: 'EDITOR_BUILD_UNSUPPORTED' } }]; } } };
  await assert.rejects(captureTabSource(api, { id: 4, url: 'https://framer.com/projects/Example--project-abc' }, { mode: 'component' }), /EDITOR_BUILD_UNSUPPORTED/);
});
