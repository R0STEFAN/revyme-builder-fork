import { describe, test, expect, vi } from 'vitest';
vi.mock('@/shared/debug-trace', () => ({ trace: { action: vi.fn(), fn: vi.fn(), error: vi.fn(), dom: vi.fn() } }));
import {
  createFormattedTextVariableInCode,
  removeTextVariableInCode,
  bindTextNodeToPropInCode,
  bakeLiteralFormattedTextInCode,
  setFormattedTextBranchInCode,
  isFormattedTextNodeInCode,
} from './variable-ops';
import { setPropTypeInCode, getPropType } from '../components/prop-meta';
import { localCssPropForVar } from '../components/prop-css-mapping';
import { parseJSXToNodes } from '../parsing/parser';
import { resolveInstancePropOverrides, parseProjectFile, clearComponentParseCache } from '../parsing/project-parser';
import { InMemoryProjectFS } from '../project/project-fs';
import { checkFile } from '../oracle/check-file';
import { analyzeEditability } from '../oracle/extensions/editability/analyzer';
import { parseInstanceProps, setInstanceProp, removeInstanceProp } from '@/editor/tools/ComponentPropsTool/instance-props';

const CARD = `'use client';

export default function Card() {
  return (
    <div data-id="root" data-name="Card" style={{ position: 'relative', width: '320px' }}>
      <p data-id="body" data-name="Body" style={{ position: 'relative', fontSize: '16px' }}>Hello <strong>world</strong>, see <a href="https://x.com">this</a></p>
    </div>
  );
}`;

const create = () => setPropTypeInCode(createFormattedTextVariableInCode(CARD, 'body', 'content'), 'content', 'formattedText');

describe('createFormattedTextVariableInCode', () => {
  test('moves the formatted content into an HTML prop rendered through dangerouslySetInnerHTML', () => {
    const out = create();
    expect(out).toMatch(/<p data-id="body"[^>]*dangerouslySetInnerHTML=\{\{\s*__html: content\s*\}\}\s*\/>/);
    expect(out).not.toContain('>Hello <strong>');
    // The default is the content as inline HTML — marks and link kept.
    const nodes = parseJSXToNodes(out);
    const node = nodes.get('body')!;
    expect(node.textContent).toBe('Hello <strong>world</strong>, see <a href="https://x.com">this</a>');
    expect(getPropType(out, 'content')).toBe('formattedText');
  });

  test('the parser binds it: pill marker + HTML paint path', () => {
    const node = parseJSXToNodes(create()).get('body')!;
    expect(node.textVariable).toBe('content');
    expect(node.formattedTextVariable).toBe(true);
    expect(node.hasMixedContent).toBe(true);
  });

  test('bails on content already bound to an expression', () => {
    const bound = CARD.replace('Hello <strong>world</strong>, see <a href="https://x.com">this</a>', '{title}');
    expect(createFormattedTextVariableInCode(bound, 'body', 'content')).toBe(bound);
  });

  test('`__html` is not mistaken for a CSS style binding', () => {
    expect(localCssPropForVar('content', create())).toBe('');
  });
});

describe('removeTextVariableInCode on a formatted binding', () => {
  test('× restores the default as the element\'s own formatted children, keeps the prop', () => {
    const out = removeTextVariableInCode(create(), 'body', 'content', '');
    expect(out).not.toContain('dangerouslySetInnerHTML');
    expect(out).toMatch(/<p data-id="body"[^>]*>[\s\S]*<strong[^>]*>world<\/strong>[\s\S]*<\/p>/);
    expect(out).toMatch(/content = /); // prop kept for re-binding
  });

  test('modal delete drops the prop too', () => {
    const out = removeTextVariableInCode(create(), 'body', 'content', '', true);
    expect(out).not.toContain('dangerouslySetInnerHTML');
    expect(out).not.toMatch(/content = /);
  });
});

describe('bindTextNodeToPropInCode with an existing formatted variable', () => {
  test('binds in the HTML shape, not as a {prop} text child', () => {
    const withVar = create();
    const second = withVar.replace(
      '<p data-id="body"',
      '<p data-id="other" data-name="Other" style={{ position: \'relative\' }}>Plain</p>\n      <p data-id="body"',
    );
    expect(second).toContain('data-id="other"');
    const out = bindTextNodeToPropInCode(second, 'other', 'content');
    expect(out).toMatch(/<p data-id="other"[^>]*dangerouslySetInnerHTML=\{\{\s*__html: content\s*\}\}\s*\/>/);
    expect(out).not.toMatch(/\{content\}/);
  });
});

describe('oracle', () => {
  const count = (code: string) =>
    checkFile(code, { kind: 'component' }).filter((x) => x.code === 'DANGEROUS_INNER_HTML').length;

  test('the formatted-variable shape passes', () => {
    expect(count(create())).toBe(0);
  });

  test('the editability analyzer does not call the shape unsupported', () => {
    const dsi = (code: string) => analyzeEditability(code, { kind: 'component' }).findings
      .filter((f) => f.evidence.startsWith('dangerouslySetInnerHTML'));
    expect(dsi(create())).toEqual([]);
    expect(dsi(create().replace('__html: content', '__html: other'))).toHaveLength(1);
  });

  test('an identifier that is not a component prop still bounces', () => {
    const local = create()
      .replace(/export default function Card\(\{[^)]*\}\)/, 'export default function Card()')
      .replace('return (', 'const content = "<b>x</b>";\n  return (');
    expect(count(local)).toBe(1);
  });
});

describe('instances', () => {
  test('an instance value overrides the master text as HTML', () => {
    const overrides = resolveInstancePropOverrides({ content: '<em>Hi</em>' }, create());
    const text = [...overrides.values()].filter((o) => o.kind === 'text');
    expect(text).toEqual([{ kind: 'text', nodeId: 'body', value: '<em>Hi</em>' }]);
    // …and never as a bogus `__html` style.
    expect([...overrides.values()].some((o) => o.kind === 'style')).toBe(false);
  });

  test('the attribute before data-id still resolves to its node', () => {
    const reordered = create().replace(
      /<p data-id="body"([^>]*?)\s*dangerouslySetInnerHTML=\{\{\s*__html: content\s*\}\}\s*\/>/,
      '<p dangerouslySetInnerHTML={{ __html: content }} data-id="body"$1 />',
    );
    const text = [...resolveInstancePropOverrides({ content: '<em>Hi</em>' }, reordered).values()];
    expect(text).toEqual([{ kind: 'text', nodeId: 'body', value: '<em>Hi</em>' }]);
  });

  const PAGE = `export default function Page() {
  return (
    <div data-id="root">
      <Card data-id="card-1" />
    </div>
  );
}`;
  const html = 'Hi <a href="https://x.com">there</a> it\'s <strong>bold</strong>';

  test('the value is written as a JS string literal and read back decoded', () => {
    const out = setInstanceProp(PAGE, 'card-1', 'Card', 'content', JSON.stringify(html), true);
    expect(out).toContain(`content={${JSON.stringify(html)}}`);
    expect(parseInstanceProps(out, 'card-1', 'Card').get('content')).toBe(html);
  });

  test('markup in a prop BEFORE data-id does not break the tag lookup', () => {
    const out = setInstanceProp(PAGE, 'card-1', 'Card', 'content', JSON.stringify(html), true);
    // setInstanceProp inserts right after the tag name → the markup sits before data-id.
    expect(out.indexOf('content=')).toBeLessThan(out.indexOf('data-id="card-1"'));
    const next = setInstanceProp(out, 'card-1', 'Card', 'content', JSON.stringify('<em>new</em>'), true);
    expect(next).toContain('<Card content={"<em>new</em>"} data-id="card-1" />');
    expect(removeInstanceProp(next, 'card-1', 'Card', 'content')).toBe(PAGE);
  });
});

describe('bakeLiteralFormattedTextInCode (detach)', () => {
  const DETACHED = `export default function Page() {
  return (
    <div data-id="det-root">
      <p data-id="det-a" style={{ fontSize: '16px' }} dangerouslySetInnerHTML={{ __html: "Hi <strong>there</strong>" }} />
      <p data-id="keep" dangerouslySetInnerHTML={{ __html: "<em>not ours</em>" }} />
    </div>
  );
}`;

  test('a literal __html on a detached node becomes its own formatted children', () => {
    const out = bakeLiteralFormattedTextInCode(DETACHED, new Set(['det-root', 'det-a']));
    expect(out).toMatch(/<p data-id="det-a"[^>]*>[\s\S]*Hi[\s\S]*<strong[^>]*>there<\/strong>[\s\S]*<\/p>/);
    expect(out).not.toContain('"Hi <strong>there</strong>"');
    // Nodes outside the detached set are left alone.
    expect(out).toMatch(/data-id="keep" dangerouslySetInnerHTML=\{\{\s*__html: "<em>not ours<\/em>"\s*\}\}/);
  });

  test('no literal formatted text → unchanged', () => {
    const code = create();
    expect(bakeLiteralFormattedTextInCode(code, new Set(['body']))).toBe(code);
  });
});

describe('instance value → canvas (project parse)', () => {
  const page = (attr: string) => `import React from 'react';
import Card from '@/components/Card';

export default function Page() {
  return (
    <div data-id="root" style={{ position: 'relative', width: '100%' }}>
      <Card ${attr}data-id="card1" />
    </div>
  );
}
`;
  const nodesFor = (attr: string) => {
    clearComponentParseCache();
    const master = create().replace("export default function Card", "export default function Card");
    return parseProjectFile('app/page.tsx', new InMemoryProjectFS(new Map([
      ['app/page.tsx', page(attr)],
      ['components/Card.tsx', master],
    ])));
  };

  test('no instance value → the master default paints as HTML', () => {
    const n = nodesFor('').get('card1:body')!;
    expect(n.textContent).toContain('<strong>world</strong>');
    expect(n.hasMixedContent).toBe(true);
  });

  test('the value the Edit Content popup writes reaches the expanded node', () => {
    const html = 'qsd<em><u>gqsd</u></em><br><a href="/about#team" target="_blank" rel="noopener noreferrer">x</a>';
    const n = nodesFor(`content={${JSON.stringify(html)}} `).get('card1:body')!;
    expect(n.textContent).toBe(html);
    expect(n.hasMixedContent).toBe(true);
  });
});

// ─── Per variant (Framer: × / bind on one variant only) ──────────────────────
const VCARD = `'use client';

export default function Card({ initialVariant = 'default' }) {
  return (
    <div data-id="root" data-name="Card" style={{ position: 'relative', width: '320px' }}>
      <p data-id="body" data-name="Body" style={{ position: 'relative', fontSize: '16px' }}>Hello <strong>world</strong></p>
    </div>
  );
}`;
const HTML = 'Hello <strong>world</strong>';
const bound = () => setPropTypeInCode(createFormattedTextVariableInCode(VCARD, 'body', 'content'), 'content', 'formattedText');
const dangerCount = (code: string) => checkFile(code, { kind: 'component' }).filter((x) => x.code === 'DANGEROUS_INNER_HTML').length;
const body = (code: string) => parseJSXToNodes(code).get('body')!;

describe('per-variant formatted text', () => {
  test('× on a variant detaches THAT variant to the formatted text it shows; others keep the variable', () => {
    const out = setFormattedTextBranchInCode(bound(), 'body', 'tablet', { kind: 'detach' });
    expect(out).toMatch(/__html: initialVariant === ["']tablet["'] \? "Hello <strong>world<\/strong>" : content/);
    const n = body(out);
    expect(n.formattedTextVariable).toBe(true);
    expect(n.textVariable).toBe('content');
    expect(n.conditionalTextVariable).toEqual({ default: 'content' });
    expect(n.conditionalText?.tablet).toBe(HTML);
    expect(n.conditionalTextRich?.tablet).toBe(true);
    expect(n.conditionalText?.default).toBe(HTML);   // the variable's value, baked for the tiles
    expect(dangerCount(out)).toBe(0);
    expect(isFormattedTextNodeInCode(out, 'body')).toBe(true);
  });

  test('the detached variant\'s own text is edited as HTML; Reset makes it follow the variable again', () => {
    const detached = setFormattedTextBranchInCode(bound(), 'body', 'tablet', { kind: 'detach' });
    const edited = setFormattedTextBranchInCode(detached, 'body', 'tablet', { kind: 'literal', html: '<em>Tab</em> text' });
    expect(body(edited).conditionalText?.tablet).toBe('<em>Tab</em> text');
    const reset = setFormattedTextBranchInCode(edited, 'body', 'tablet', { kind: 'clear' });
    expect(reset).toMatch(/dangerouslySetInnerHTML=\{\{\s*__html: content\s*\}\}/);
    expect(body(reset).conditionalText).toBeFalsy();
  });

  test('bind a NEW formatted variable on one variant only; the others keep their text', () => {
    const out = setPropTypeInCode(setFormattedTextBranchInCode(VCARD, 'body', 'tablet', { kind: 'var', prop: 'tabText' }), 'tabText', 'formattedText');
    expect(out).toMatch(/__html: initialVariant === ["']tablet["'] \? tabText : "Hello <strong>world<\/strong>"/);
    expect(out).toMatch(/tabText = "Hello <strong>world<\/strong>"/);    // declared with what the variant showed
    const n = body(out);
    expect(n.textContent).toBe(HTML);                                   // primary: its own text
    expect(n.conditionalTextVariable).toEqual({ tablet: 'tabText' });
    expect(n.conditionalText?.tablet).toBe(HTML);
    expect(dangerCount(out)).toBe(0);
  });

  test('× on the primary unbinds the primary only; a variant bound on its own keeps its variable', () => {
    const both = setFormattedTextBranchInCode(bound(), 'body', 'tablet', { kind: 'var', prop: 'tabText' });
    const out = removeTextVariableInCode(both, 'body', 'content', '');
    expect(out).toMatch(/__html: initialVariant === ["']tablet["'] \? tabText : "Hello <strong>world<\/strong>"/);
  });

  test('no variable left → ordinary text again: plain children, or a rich per-variant ternary', () => {
    const tabOnly = setFormattedTextBranchInCode(VCARD, 'body', 'tablet', { kind: 'var', prop: 'tabText' });
    // Detached back to the same text as the primary → just the formatted children.
    const same = setFormattedTextBranchInCode(tabOnly, 'body', 'tablet', { kind: 'detach' });
    expect(same).not.toContain('dangerouslySetInnerHTML');
    expect(same).toMatch(/<p data-id="body"[^>]*>[\s\S]*Hello[\s\S]*<strong[^>]*>world<\/strong>[\s\S]*<\/p>/);
    // Different per-variant text → the existing rich per-variant children form.
    const differs = setFormattedTextBranchInCode(
      setFormattedTextBranchInCode(tabOnly, 'body', 'tablet', { kind: 'literal', html: '<em>Tab</em>' }),
      'body', 'default', { kind: 'literal', html: HTML },
    );
    expect(differs).not.toContain('dangerouslySetInnerHTML');
    const n = body(differs);
    expect(n.conditionalText?.tablet).toMatch(/<em[^>]*>Tab<\/em>/);
    expect(n.conditionalTextRich?.tablet).toBe(true);
  });

  test('a per-variant CHILDREN ternary becomes formatted on the primary, variants keep their text', () => {
    const tern = VCARD.replace('>Hello <strong>world</strong></p>', ">{initialVariant === 'tablet' ? 'Tab & co' : 'Hello'}</p>");
    const out = createFormattedTextVariableInCode(tern, 'body', 'content');
    expect(out).toMatch(/__html: initialVariant === ["']tablet["'] \? "Tab &amp; co" : content/);
    expect(out).toMatch(/content = "Hello"/);
  });
});

describe('per-variant formatted text on instances', () => {
  const page = (attrs: string) => `import React from 'react';
import Card from '@/components/Card';
export default function Page() {
  return (
    <div data-id="root" style={{ position: 'relative', width: '100%' }}>
      <Card ${attrs} data-id="c1" />
    </div>
  );
}
`;
  const expand = (master: string, attrs: string) => {
    clearComponentParseCache();
    return parseProjectFile('app/page.tsx', new InMemoryProjectFS(new Map([
      ['app/page.tsx', page(attrs)], ['components/Card.tsx', master],
    ]))).get('c1:body')!;
  };

  test('a variant bound on its own shows the INSTANCE value', () => {
    const master = setFormattedTextBranchInCode(VCARD, 'body', 'tablet', { kind: 'var', prop: 'tabText' });
    expect(expand(master, 'initialVariant="tablet" tabText={"<em>mine</em>"}').conditionalText?.tablet).toBe('<em>mine</em>');
  });

  test('a detached variant keeps its own text; the default follows the instance value', () => {
    const master = setFormattedTextBranchInCode(bound(), 'body', 'tablet', { kind: 'detach' });
    const n = expand(master, 'content={"<b>x</b>"}');
    expect(n.textContent).toBe('<b>x</b>');
    expect(n.conditionalText?.default).toBe('<b>x</b>');
    expect(n.conditionalText?.tablet).toBe(HTML);
  });
});
