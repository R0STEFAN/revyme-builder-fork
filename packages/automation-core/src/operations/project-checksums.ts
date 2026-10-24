import { createHash } from 'node:crypto';

/** Hash a file dictionary with stable key ordering for backup validation. */
export function calculateFilesChecksum(files: Record<string, string>): string {
  const sortedKeys = Object.keys(files).sort();
  const hash = createHash('sha256');
  for (const key of sortedKeys) {
    hash.update(key);
    hash.update(':');
    hash.update(files[key]);
    hash.update(';');
  }
  return hash.digest('hex');
}

/** Cover branch contents and the active pointer as well as main files. */
export function calculateBackupEnvelopeChecksum(files: Record<string, string>, branches: unknown, activeBranchId: string): string {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => [k, canonical(v)]));
    return value;
  };
  return createHash('sha256').update(JSON.stringify(canonical({ files, branches: branches ?? {}, activeBranchId }))).digest('hex');
}
