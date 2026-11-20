import { describe, it, expect } from 'vitest';
import { ingestJSXFragment } from '../../src/ingestion/jsx';

function flattenRenderedText(node: ReturnType<typeof ingestJSXFragment>): string {
  if (!node) return '';
  if (node.children && node.children.length > 0) {
    return (node.text ?? '') + node.children.map((c) => flattenRenderedText(c)).join('');
  }
  return node.text ?? '';
}

describe('Task 9: preserve mixed-content inline whitespace in text elements', () => {
  it('preserves separating spaces around inline <span> inside <h2>', () => {
    const parsed = ingestJSXFragment(
      `<h2>AND <span style={{ fontStyle: 'italic' }}>silence</span> TAKES</h2>`
    );
    expect(parsed).not.toBeNull();
    expect(flattenRenderedText(parsed)).toBe('AND silence TAKES');
  });

  it('collapses multiline JSX indentation while keeping single boundary space next to inline span', () => {
    const parsed = ingestJSXFragment(
      `<p>
        Built with
        <span>precision</span>
        today.
      </p>`
    );
    expect(parsed).not.toBeNull();
    expect(flattenRenderedText(parsed)).toBe('Built with precision today.');
  });

  it('preserves a separating space node between adjacent inline elements', () => {
    const parsed = ingestJSXFragment(
      `<h2><span>AND</span> <span>TAKES</span></h2>`
    );
    expect(parsed).not.toBeNull();
    expect(flattenRenderedText(parsed)).toBe('AND TAKES');
  });

  it('still drops indentation whitespace between block elements in <div>', () => {
    const parsed = ingestJSXFragment(
      `<div>
        <div>First</div>
        <div>Second</div>
      </div>`
    );
    expect(parsed?.children?.map((c) => c.tag)).toEqual(['p', 'p']);
    expect(parsed?.children?.some((c) => c.tag === 'span')).toBe(false);
  });
});
