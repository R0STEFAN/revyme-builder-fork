// packages/automation-core/src/ingestion/ids.ts
import type { IngestionReporter } from './report';

export class IdManager {
  private usedIds = new Set<string>();
  private counter = 1;

  constructor(initialIds: Iterable<string> = []) {
    for (const id of initialIds) {
      this.usedIds.add(id);
    }
  }

  ensureNodeId(
    candidateId?: string,
    tag = 'div',
    reporter?: IngestionReporter
  ): { id: string; wasGenerated: boolean } {
    const cleanTag = tag.toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'node';

    // 1. Missing ID
    if (!candidateId || !candidateId.trim()) {
      let generated = `${cleanTag}-${this.counter++}`;
      while (this.usedIds.has(generated)) {
        generated = `${cleanTag}-${this.counter++}`;
      }
      this.usedIds.add(generated);
      reporter?.recordNormalization(
        'ASSIGN_MISSING_ID',
        generated,
        '',
        generated
      );
      return { id: generated, wasGenerated: true };
    }

    const trimmed = candidateId.trim();

    // 2. Sanitize characters if needed
    const sanitized = trimmed.replace(/[^a-zA-Z0-9_-]/g, '-');
    if (sanitized !== trimmed) {
      reporter?.recordNormalization('SANITIZE_ID', trimmed, trimmed, sanitized);
    }

    // 3. Handle duplicates
    if (this.usedIds.has(sanitized)) {
      let renumbered = `${sanitized}-${this.counter++}`;
      while (this.usedIds.has(renumbered)) {
        renumbered = `${sanitized}-${this.counter++}`;
      }
      this.usedIds.add(renumbered);
      reporter?.recordNormalization(
        'DUPLICATE_ID_RENUMBERED',
        sanitized,
        sanitized,
        renumbered
      );
      return { id: renumbered, wasGenerated: true };
    }

    this.usedIds.add(sanitized);
    return { id: sanitized, wasGenerated: false };
  }

  has(id: string): boolean {
    return this.usedIds.has(id);
  }

  register(id: string): void {
    this.usedIds.add(id);
  }
}
