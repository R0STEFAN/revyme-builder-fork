import { describe, it, expect } from 'vitest';
import { normalizeCandidateChanges } from '../src/ingestion/candidate';
import { createSnapshot } from '../src/session';
import { checkFile } from '../../../src/code/oracle/check-file';

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

  it('makes newly inserted flex children reorderable and non-shrinking before Oracle validation', () => {
    const source = `export default function Page() {
  return <div data-id="root" style={{ position: 'relative' }}>
    <div data-id="faq-list" style={{ position: 'relative', display: 'flex', flexDirection: 'column' }}>
      <p data-id="faq-placeholder" style={{ position: 'relative', padding: '24px 0' }}>Placeholder</p>
      <FAQItem data-id="faq-item-instance" style={{ position: 'relative', width: '100%' }} />
    </div>
  </div>;
}`;
    const candidate = createSnapshot({ projectId: 'components', branchId: 'main' }, 1, { [file]: '' });
    const result = normalizeCandidateChanges(candidate, [{ path: file, beforeHash: null, content: source }]);
    const normalized = result.changes[0].content!;
    const violations = checkFile(normalized, { kind: 'page', path: file })
      .filter((issue) => issue.code === 'FLEX_CHILD_MISSING_ORDER' || issue.code === 'FLEX_CHILD_SHRINKS');

    expect(normalized).toMatch(/data-id="faq-placeholder" style=\{\{[^}]*order: '0'[^}]*flex: '0 0 auto'/);
    expect(normalized).toMatch(/data-id="faq-item-instance" style=\{\{[^}]*order: '1'[^}]*flex: '0 0 auto'/);
    expect(violations).toEqual([]);
  });
});
