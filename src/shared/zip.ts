// zip.ts — build a .zip in the browser, no dependency.
//
// The standalone editor exports its project locally (there is no backend to
// build the archive), so the zip is assembled here: local file headers, the
// central directory, the end record — the plain PKZIP layout every unzipper
// reads. Entries are DEFLATED with the platform's own `CompressionStream`
// ('deflate-raw', every current browser and Node 18+) and STORED when that is
// missing or does not shrink the file. UTF-8 names (flag bit 11), no Zip64
// (a website's source is nowhere near 4 GB).

export interface ZipEntry {
  path: string;
  data: Uint8Array | string;
}

const encoder = new TextEncoder();

let crcTable: Uint32Array | null = null;
function table(): Uint32Array {
  if (crcTable) return crcTable;
  crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  return crcTable;
}

export function crc32(bytes: Uint8Array): number {
  const t = table();
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = t[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function deflateRaw(bytes: Uint8Array): Promise<Uint8Array | null> {
  if (typeof CompressionStream === 'undefined') return null;
  try {
    // A copy on a plain ArrayBuffer — what Blob accepts (not a SharedArrayBuffer view).
    const stream = new Blob([new Uint8Array(bytes)]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null;   // 'deflate-raw' unsupported here — store instead
  }
}

/** MS-DOS date/time, the only timestamp the base format carries. */
function dosDateTime(d: Date): { time: number; date: number } {
  const year = Math.max(1980, d.getFullYear());
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/** The archive's bytes. Paths are forward-slash, unrooted (`app/page.tsx`). */
export async function buildZip(entries: ZipEntry[], opts: { now?: Date; compress?: boolean } = {}): Promise<Uint8Array<ArrayBuffer>> {
  const { time, date } = dosDateTime(opts.now ?? new Date());
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const e of entries) {
    const name = encoder.encode(e.path.replace(/^\/+/, ''));
    const raw = typeof e.data === 'string' ? encoder.encode(e.data) : e.data;
    const crc = crc32(raw);
    const deflated = opts.compress === false ? null : await deflateRaw(raw);
    const useDeflate = !!deflated && deflated.length < raw.length;
    const body = useDeflate ? (deflated as Uint8Array) : raw;
    const method = useDeflate ? 8 : 0;

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);   // local file header
    local.setUint16(4, 20, true);           // version needed
    local.setUint16(6, 0x0800, true);       // UTF-8 names
    local.setUint16(8, method, true);
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, body.length, true);
    local.setUint32(22, raw.length, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);
    parts.push(new Uint8Array(local.buffer), name, body);

    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);      // central directory header
    cd.setUint16(4, 20, true);              // version made by
    cd.setUint16(6, 20, true);              // version needed
    cd.setUint16(8, 0x0800, true);
    cd.setUint16(10, method, true);
    cd.setUint16(12, time, true);
    cd.setUint16(14, date, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, body.length, true);
    cd.setUint32(24, raw.length, true);
    cd.setUint16(28, name.length, true);
    cd.setUint16(30, 0, true);              // extra
    cd.setUint16(32, 0, true);              // comment
    cd.setUint16(34, 0, true);              // disk
    cd.setUint16(36, 0, true);              // internal attrs
    cd.setUint32(38, 0, true);              // external attrs
    cd.setUint32(42, offset, true);         // local header offset
    central.push(new Uint8Array(cd.buffer), name);

    offset += 30 + name.length + body.length;
  }

  const cdSize = central.reduce((n, p) => n + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);       // end of central directory
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);

  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(new ArrayBuffer(all.reduce((n, p) => n + p.length, 0)));
  let at = 0;
  for (const p of all) { out.set(p, at); at += p.length; }
  return out;
}
