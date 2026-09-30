// @vitest-environment node
// (Node has CompressionStream — the deflate path runs for real.)

import { describe, it, expect } from 'vitest';
import { inflateRawSync } from 'node:zlib';
import { buildZip, crc32 } from './zip';

/** Minimal reader: the central directory, then each local entry. */
function readZip(buf: Uint8Array): Array<{ path: string; text: string; method: number; crcOk: boolean }> {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const eocd = buf.length - 22;
  expect(dv.getUint32(eocd, true)).toBe(0x06054b50);
  const count = dv.getUint16(eocd + 10, true);
  let at = dv.getUint32(eocd + 16, true);
  const out = [];
  for (let i = 0; i < count; i++) {
    expect(dv.getUint32(at, true)).toBe(0x02014b50);
    const method = dv.getUint16(at + 10, true);
    const crc = dv.getUint32(at + 16, true);
    const csize = dv.getUint32(at + 20, true);
    const nameLen = dv.getUint16(at + 28, true);
    const local = dv.getUint32(at + 42, true);
    const path = new TextDecoder().decode(buf.subarray(at + 46, at + 46 + nameLen));
    expect(dv.getUint32(local, true)).toBe(0x04034b50);
    const lnameLen = dv.getUint16(local + 26, true);
    const data = buf.subarray(local + 30 + lnameLen, local + 30 + lnameLen + csize);
    const raw = method === 8 ? new Uint8Array(inflateRawSync(data)) : data;
    out.push({ path, text: new TextDecoder().decode(raw), method, crcOk: crc32(raw) === crc });
    at += 46 + nameLen;
  }
  return out;
}

describe('buildZip', () => {
  const big = 'export default function Page() { return null; }\n'.repeat(200);
  const entries = [
    { path: 'app/page.client.tsx', data: big },
    { path: 'README.md', data: '# Café — été\n' },
    { path: 'tiny.txt', data: 'x' },
  ];

  it('writes a valid archive: names (UTF-8), contents and CRCs round-trip, big files deflated', async () => {
    const zip = await buildZip(entries, { now: new Date(2026, 8, 30, 12, 0, 0) });
    const read = readZip(zip);
    expect(read.map((e) => e.path)).toEqual(['app/page.client.tsx', 'README.md', 'tiny.txt']);
    expect(read[0].text).toBe(big);
    expect(read[1].text).toBe('# Café — été\n');
    expect(read.every((e) => e.crcOk)).toBe(true);
    expect(read[0].method).toBe(8);   // shrinks → deflated
    expect(read[2].method).toBe(0);   // would grow → stored
    expect(zip.length).toBeLessThan(big.length);
  });

  it('stores everything when compression is off', async () => {
    const read = readZip(await buildZip(entries, { compress: false }));
    expect(read.every((e) => e.method === 0 && e.crcOk)).toBe(true);
    expect(read[0].text).toBe(big);
  });

  it('crc32 matches the reference value', () => {
    expect(crc32(new TextEncoder().encode('The quick brown fox jumps over the lazy dog'))).toBe(0x414fa339);
  });
});
