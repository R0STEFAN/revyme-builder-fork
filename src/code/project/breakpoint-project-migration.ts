// breakpoint-project-migration.ts — the start-model breakpoint migration for ONE stored project
// (a `websites.json` / `website_snapshots.json` / template `snapshot.json` value: `{ format, files }`).
//
// Every `.tsx` file goes through migrateFileToStartBreakpoints and must pass its proof
// (proveFileMigration: each tile drawn at the same width resolves exactly the same, nothing left
// keyed at an old width). ALL OR NOTHING per project: one unproven file refuses the whole project,
// so a site is never left half-migrated (a page migrated under a template that is not). Files the
// migration leaves alone (no @canvas, one viewport, already start model) stay byte-identical.
// Idempotent: a migrated project migrates to itself. Pure — no I/O; the caller stores the result.

import { migrateFileToStartBreakpoints } from './breakpoint-start-migration';
import { proveFileMigration } from './breakpoint-proof';

export interface StoredProject { format?: unknown; files?: Record<string, unknown>; [k: string]: unknown }

export interface ProjectMigrationResult {
  /** The migrated project — only when every changed file is proven and something changed. */
  project: StoredProject | null;
  changed: Array<{ path: string; steps: string }>;
  /** Files whose proof failed (the project is refused when non-empty). */
  refused: Array<{ path: string; problems: string[] }>;
}

export function migrateProjectToStartBreakpoints(project: StoredProject): ProjectMigrationResult {
  const result: ProjectMigrationResult = { project: null, changed: [], refused: [] };
  const files = project.files;
  if (!files || typeof files !== 'object') return result;
  const nextFiles: Record<string, unknown> = {};
  for (const [path, code] of Object.entries(files)) {
    nextFiles[path] = code;
    if (!path.endsWith('.tsx') || typeof code !== 'string' || !code.includes('@canvas')) continue;
    let migrated: ReturnType<typeof migrateFileToStartBreakpoints>;
    try {
      migrated = migrateFileToStartBreakpoints(code);
    } catch (e) {
      result.refused.push({ path, problems: [`threw: ${(e as Error).message}`] });
      continue;
    }
    if (migrated.steps.length === 0) continue;
    const problems = proveFileMigration(code, migrated.code, migrated.steps.map((s) => s.oldEnd));
    // Idempotence is part of the proof: the migrated file must be a fixed point.
    if (migrateFileToStartBreakpoints(migrated.code).code !== migrated.code) problems.push('not idempotent');
    if (problems.length) { result.refused.push({ path, problems }); continue; }
    nextFiles[path] = migrated.code;
    result.changed.push({ path, steps: migrated.steps.map((s) => `${s.id} ${s.oldEnd}→${s.newEnd} (starts ${s.start})`).join(', ') });
  }
  if (result.refused.length === 0 && result.changed.length > 0) result.project = { ...project, files: nextFiles };
  return result;
}
