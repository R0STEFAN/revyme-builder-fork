import { describe, it, expect } from 'vitest';
import { normalizeCandidateChanges } from '../src/ingestion/candidate';
import { createSnapshot } from '../src/session';

const file = 'app/page.client.tsx';
const code = `// keep formatting\nexport default function Page(){return <div data-id="root" style={{padding:'1.5rem', width:'50%', marginTop:'2em', fontSize:'20px'}}/>;}`;
const snapshot = createSnapshot({ projectId: 'normalize', branchId: 'main' }, 1, { [file]: code }, { unitContext: { rootFontSize: 20 } });

describe('canonical source normalization', () => {
  it('lowers only px-only literal lengths and preserves unrelated source exactly', () => {
    const result = normalizeCandidateChanges(snapshot, [{ path: file, beforeHash: null, content: code }]);
    expect(result.issues).toEqual([]);
    expect(result.changes[0].content).toBe(code.replace("'1.5rem'", '"30px"').replace("'2em'", '"40px"'));
    expect(result.normalizations.map((n) => n.after)).toEqual(['30px', '40px']);
    const second = normalizeCandidateChanges(snapshot, result.changes);
    expect(second.changes).toEqual(result.changes);
    expect(second.normalizations).toEqual([]);
  });

  it('reports unknown root context instead of assuming 16px', () => {
    const result = normalizeCandidateChanges({ ...snapshot, config: {} }, [{ path: file, beforeHash: null, content: code }]);
    expect(result.issues.some((i) => i.code === 'MISSING_ROOT_FONT_CONTEXT')).toBe(true);
    expect(result.issues[0].source?.file).toBe(file);
    expect(result.changes[0].content).toContain("padding:'1.5rem'");
  });

  it('refuses ambiguous expressions and inherited em font sizes', () => {
    const source = code.replace("'1.5rem'", "'calc(1rem + 10px)'").replace(", fontSize:'20px'", '');
    const result = normalizeCandidateChanges(snapshot, [{ path: file, beforeHash: null, content: source }]);
    expect(result.issues.map((i) => i.code)).toEqual(['AMBIGUOUS_UNIT_EXPRESSION', 'MISSING_ELEMENT_FONT_CONTEXT']);
    expect(result.changes[0].content).toBe(source);
  });

  it('coalesces repeated edits using the original snapshot hash', () => {
    const result = normalizeCandidateChanges(snapshot, [
      { path: 'notes.txt', beforeHash: null, content: 'intermediate' },
      { path: 'notes.txt', beforeHash: 'intermediate-hash', content: 'final' },
    ]);
    expect(result.changes).toEqual([{ path: 'notes.txt', beforeHash: null, content: 'final' }]);
  });
});
