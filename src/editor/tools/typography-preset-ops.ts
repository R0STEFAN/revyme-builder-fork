// typography-preset-ops.ts — project-wide writes for typography presets.

import { projectFS } from '@/code/project/project-fs';
import { modifyProjectFile } from '@/code/project/modify-file';
import { bindPresetStrokeInCode } from '@/code/generation/typo-preset-gen';
import { trace } from '@/shared/debug-trace';

/**
 * A preset just GAINED a text stroke: bind it on every text already using the
 * preset, in every file (pages, the template, components), so they show it the
 * way they show the preset's color or size — see bindPresetStrokeInCode.
 * Returns how many files changed.
 */
export function bindPresetStrokeAcrossProject(groupName: string): number {
  const marker = `--typo-${groupName}-font`;
  let changed = 0;
  for (const path of projectFS.listFiles()) {
    if (!path.endsWith('.tsx')) continue;
    const code = projectFS.readFile(path);
    if (!code || !code.includes(marker)) continue;
    const before = code;
    modifyProjectFile(path, (c) => bindPresetStrokeInCode(c, groupName));
    if (projectFS.readFile(path) !== before) changed++;
  }
  trace.action('typography-preset:bind-stroke-across-project', { groupName, files: changed });
  return changed;
}
