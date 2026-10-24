import { parse } from '@babel/parser';
import { createHash } from 'node:crypto';
import type { FileChange, Snapshot, Issue, Normalization } from '../contracts';
import { isCodeComponentSource } from '@/code/oracle/checks/shared';
import { SPACING_PX_KEYS } from '@/code/oracle/checks/style-object';
import { applyRuntimeGuarantees } from '@/code/generation/runtime-guarantees';
import { lowerUnits } from './units';
import { IngestionReporter } from './report';

// Work on source spans so normalization never prints/reorders unrelated JSX or CSS.
// Unit context is explicit project configuration; there is no assumed 16px root.
export function normalizeCandidateChanges(snapshot: Snapshot, changes: FileChange[]): {
  changes: FileChange[]; issues: Issue[]; normalizations: Normalization[];
} {
  const issues: Issue[] = [];
  const normalizations: Normalization[] = [];
  const finalChanges = new Map(changes.map((change) => [change.path, { ...change }]));
  const configured = snapshot.config.unitContext as { rootFontSize?: number } | undefined;
  const rootFontSize = typeof configured?.rootFontSize === 'number' && Number.isFinite(configured.rootFontSize) && configured.rootFontSize > 0
    ? configured.rootFontSize : undefined;
  for (const change of finalChanges.values()) {
    const original = snapshot.files.get(change.path);
    change.beforeHash = original === undefined ? null : createHash('sha256').update(original).digest('hex');
    const source = change.content;
    if (source === null || !/\.[jt]sx$/.test(change.path) || isCodeComponentSource(source)) continue;
    let ast;
    try { ast = parse(source, { sourceType: 'module', plugins: ['jsx', 'typescript'] }); }
    catch { continue; } // The final validator reports syntax errors.
    const edits: Array<{ start: number; end: number; text: string }> = [];
    function walk(node: any): void {
      if (!node || typeof node !== 'object') return;
      if (node.type === 'JSXAttribute' && node.name?.name === 'style' && node.value?.expression?.type === 'ObjectExpression') {
        const props = node.value.expression.properties;
        const fontProperties = props.filter((p: any) => !p.computed && (p.key?.name ?? p.key?.value) === 'fontSize');
        const font = fontProperties.length === 1 ? fontProperties[0].value : undefined;
        const elementFontSize = font?.type === 'NumericLiteral' ? font.value
          : font?.type === 'StringLiteral' && /^\d+(?:\.\d+)?px$/.test(font.value) ? parseFloat(font.value) : undefined;
        for (const prop of props) {
          const key = !prop.computed && (prop.key?.name ?? prop.key?.value);
          const value = prop.value;
          if (!SPACING_PX_KEYS.has(key) || value?.type !== 'StringLiteral' || !/\d(?:rem|em)\b/.test(value.value)) continue;
          const target = `${change.path}:${value.loc?.start.line ?? 1}:${key}`;
          // Only literal length lists can be lowered without changing expression semantics.
          if (!value.value.trim().split(/\s+/).every((part: string) => /^-?(?:\d*\.)?\d+(?:px|rem|em)?$/.test(part) || (key.startsWith('margin') && part === 'auto'))) {
            issues.push({ code: 'AMBIGUOUS_UNIT_EXPRESSION', path: [change.path, key], message: `Cannot normalize ${key} without resolving its expression`, source: { file: change.path, line: value.loc?.start.line ?? 1 } });
            continue;
          }
          if (/\d+em\b/.test(value.value) && (elementFontSize === undefined || props.some((p: any) => p.type === 'SpreadElement' || p.computed))) {
            issues.push({ code: 'MISSING_ELEMENT_FONT_CONTEXT', path: [change.path, key], message: `Cannot normalize ${key} in em without a fixed element font size`, source: { file: change.path, line: value.loc?.start.line ?? 1 } });
            continue;
          }
          const reporter = new IngestionReporter();
          const lowered = lowerUnits(value.value, { rootFontSize, elementFontSize }, reporter, target);
          issues.push(...reporter.getIssues().map((issue) => ({ ...issue, source: { file: change.path, line: value.loc?.start.line ?? 1 } })));
          normalizations.push(...reporter.getNormalizations());
          if (lowered !== value.value) edits.push({ start: value.start, end: value.end, text: JSON.stringify(lowered) });
        }
      }
      for (const [key, child] of Object.entries(node)) {
        if (key === 'loc') continue;
        if (Array.isArray(child)) child.forEach(walk);
        else if (child && typeof child === 'object') walk(child);
      }
    }
    walk(ast.program);
    let content = source;
    for (const edit of edits.sort((a, b) => b.start - a.start)) content = content.slice(0, edit.start) + edit.text + content.slice(edit.end);
    change.content = applyRuntimeGuarantees(content);
  }
  return { changes: [...finalChanges.values()], issues, normalizations };
}
