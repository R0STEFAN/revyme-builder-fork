import { describe, test, expect, it } from 'vitest';
import { parseInstanceProps, setInstanceProp, removeInstanceProp, setConditionalInstanceProp, getInstancePropExpr } from './instance-props';

describe('exact JSX instance identity', () => {
  it('reads and edits the second single-quoted id', () => {
    const code = "<div><Card data-id='a' title='A'/><Card data-id='b' title='B'/></div>";
    expect(parseInstanceProps(code, 'b', 'Card').get('title')).toBe('B');
    const result = setInstanceProp(code, 'b', 'Card', 'title', 'New');
    expect(result).toContain("data-id='a' title='A'");
    expect(result).toContain("data-id='b' title=\"New\"");
  });

  it('matches a string expression id', () => {
    const code = '<Card data-id={"b"} title="B" />';
    expect(parseInstanceProps(code, 'b', 'Card').get('title')).toBe('B');
  });

  it('refuses a missing id when multiple instances exist', () => {
    const code = '<><Card data-id="a"/><Card data-id="b"/></>';
    expect(setInstanceProp(code, 'missing', 'Card', 'title', 'Wrong')).toBe(code);
  });

  it('refuses a duplicate id', () => {
    const code = '<><Card data-id="a"/><Card data-id="a"/></>';
    expect(setInstanceProp(code, 'a', 'Card', 'title', 'Wrong')).toBe(code);
  });

  it('does not edit a different JSX tag that carries the requested id', () => {
    const code = '<><div data-id="target" title="Foreign"/><Card data-id="other" title="Card"/></>';
    expect(parseInstanceProps(code, 'target', 'Card').size).toBe(0);
    expect(setInstanceProp(code, 'target', 'Card', 'title', 'Wrong')).toBe(code);
    expect(removeInstanceProp(code, 'target', 'Card', 'title')).toBe(code);
    expect(setConditionalInstanceProp(code, 'target', 'Card', 'title', 'Hover', 'Wrong')).toBe(code);
    expect(getInstancePropExpr(code, 'target', 'Card', 'title')).toBeNull();
  });

  it('refuses a duplicate id even when the duplicate uses another tag', () => {
    const code = '<><div data-id="target"/><Card data-id="target" title="Card"/></>';
    expect(parseInstanceProps(code, 'target', 'Card').size).toBe(0);
    expect(setInstanceProp(code, 'target', 'Card', 'title', 'Wrong')).toBe(code);
  });

  it('refuses an unrelated generated-looking component tag across all public operations', () => {
    const code = '<Other data-id="Other-x" data-name="Other" title="Foreign" />';
    expect(parseInstanceProps(code, 'Other-x', 'Card').size).toBe(0);
    expect(setInstanceProp(code, 'Other-x', 'Card', 'title', 'Wrong')).toBe(code);
    expect(removeInstanceProp(code, 'Other-x', 'Card', 'title')).toBe(code);
    expect(setConditionalInstanceProp(code, 'Other-x', 'Card', 'title', 'Hover', 'Wrong')).toBe(code);
    expect(getInstancePropExpr(code, 'Other-x', 'Card', 'title')).toBeNull();
  });
});

// The expression branch of parseInstanceProps' prop regex must tolerate ONE
// nested brace level: a whole-value image binding (`coverImage={`url(${item.f})`}`)
// or an object value used to be truncated at the FIRST inner `}` — a mangled
// half-expression that broke the panel's CMS pill detection (the pill regex
// never matched, so a bound image prop showed "Pick image" instead of the pill).
describe('parseInstanceProps — nested-brace expression values', () => {
  test('captures a whole-value url template binding WHOLE', () => {
    const code = `<CoKaGo data-id="card-1" coverImage={\`url(\${item.coverImage})\`} title2={item.title2} />`;
    const props = parseInstanceProps(code, 'card-1', 'CoKaGo');
    expect(props.get('coverImage')).toBe('`url(${item.coverImage})`');
    expect(props.get('title2')).toBe('item.title2');
  });

  test('captures an object expression value WHOLE', () => {
    const code = `<JiRoKu data-id="svc-1" cursorOpts={{"variant":"brand","mode":"replace"}} cursor={HeXiLe} />`;
    const props = parseInstanceProps(code, 'svc-1', 'JiRoKu');
    expect(props.get('cursorOpts')).toBe('{"variant":"brand","mode":"replace"}');
    expect(props.get('cursor')).toBe('HeXiLe');
  });

  test('plain values unchanged (string / numeric / identifier)', () => {
    const code = `<Card data-id="c-1" title="Neon" count={3} onSel={handler} />`;
    const props = parseInstanceProps(code, 'c-1', 'Card');
    expect(props.get('title')).toBe('Neon');
    expect(props.get('count')).toBe('3');
    expect(props.get('onSel')).toBe('handler');
  });
});

// Banded-expression attrs — the peeled base branch is raw JS source. A quoted
// literal must be UNQUOTED (a select fed `"flex-end"` with quotes matches no
// option and renders the first one — the "Justify shows Start though the code
// says flex-end" find), and a bare `undefined` base means unset.
describe('parseInstanceProps banded-expression base peel', () => {
  const CODE = `function P(){
  const __mq0 = useMediaQuery('(max-width: 768px)');
  const __activeLocale = 'en';
  return <div><Hero justify={(__activeLocale === 'fr' && __mq0 ? undefined : "flex-end")} count={(__mq0 ? 3 : 7)} gone={(__mq0 ? "x" : undefined)} data-id="h" data-name="Hero" /></div>;
}`;
  it('unquotes a string-literal base', () => {
    expect(parseInstanceProps(CODE, 'h', 'Hero').get('justify')).toBe('flex-end');
  });
  it('non-literal bases (numbers) pass through raw', () => {
    expect(parseInstanceProps(CODE, 'h', 'Hero').get('count')).toBe('7');
  });
  it('a bare `undefined` base = unset (falls to the master default downstream)', () => {
    expect(parseInstanceProps(CODE, 'h', 'Hero').has('gone')).toBe(false);
  });
});

// ─── Registry-name ≠ tag-name insert corruption (2026-07-30) ────────────────
//
// The registry's INTERNAL function name can be `CurvedCorner` while the JSX
// import alias is `ZaPoKa`. The caller passes the proven local tag to these
// helpers. The old add-prop insert offset landed INSIDE
// `data-id="…"`, splitting it into bare `data-` + `id="…"`. The node then
// parsed as `auto_N` and every mutation silently no-oped (drag-out reverted
// on the next parse).
describe('setInstanceProp — import alias and insertion offset', () => {
  const CODE = `<div data-id="root"><ZaPoKa data-id="ZaPoKa-ms6axrg7-h" layout={true} data-name="ZaPoKa" style={{ left: '95px' }}></ZaPoKa></div>`;

  it('inserts after the REAL tag name, never inside data-id', () => {
    const out = setInstanceProp(CODE, 'ZaPoKa-ms6axrg7-h', 'ZaPoKa', 'corner', 'bottom-right');
    expect(out).toContain('<ZaPoKa corner="bottom-right" data-id="ZaPoKa-ms6axrg7-h"');
    expect(out).not.toContain('data- ');
    expect(out).not.toMatch(/data-\scorner/);
  });

  it('expression props too', () => {
    const out = setInstanceProp(CODE, 'ZaPoKa-ms6axrg7-h', 'ZaPoKa', 'curveRadius', '18', true);
    expect(out).toContain('<ZaPoKa curveRadius={18} data-id="ZaPoKa-ms6axrg7-h"');
  });
});

// ─── Per-parent-variant GENERIC prop writes (code-component props) ──────────
describe('setConditionalInstanceProp — generic props with defaultSeed + raw literals', () => {
  const CODE = `<div data-id="root"><ZaPoKa data-id="z-1" data-name="ZaPoKa" style={{ left: '1px' }} /></div>`;

  it('absent prop + variant write seeds the DEFAULT branch from defaultSeed', () => {
    const out = setConditionalInstanceProp(CODE, 'z-1', 'ZaPoKa', 'fillColor', 'Hover', '#8C3030', '#28282c');
    expect(out).toContain(`fillColor={initialVariant === 'Hover' ? '#8C3030' : '#28282c'}`);
  });

  it('default-branch write preserves existing variant branches', () => {
    const withHover = setConditionalInstanceProp(CODE, 'z-1', 'ZaPoKa', 'fillColor', 'Hover', '#8C3030', '#28282c');
    const out = setConditionalInstanceProp(withHover, 'z-1', 'ZaPoKa', 'fillColor', 'default', '#111111');
    expect(out).toContain(`fillColor={initialVariant === 'Hover' ? '#8C3030' : '#111111'}`);
  });

  it('numeric and boolean branches stay RAW (unquoted) and round-trip', () => {
    const num = setConditionalInstanceProp(CODE, 'z-1', 'ZaPoKa', 'curveRadius', 'Hover', '18', '14');
    expect(num).toContain(`curveRadius={initialVariant === 'Hover' ? 18 : 14}`);
    const bool = setConditionalInstanceProp(num, 'z-1', 'ZaPoKa', 'invert', 'Hover', 'true', 'false');
    expect(bool).toContain(`invert={initialVariant === 'Hover' ? true : false}`);
    // Round-trip: a second write on another variant keeps the typed branches.
    const num2 = setConditionalInstanceProp(bool, 'z-1', 'ZaPoKa', 'curveRadius', 'Pressed', '6');
    expect(num2).toContain(`curveRadius={initialVariant === 'Hover' ? 18 : initialVariant === 'Pressed' ? 6 : 14}`);
  });

  it('expression base (`prop={14}`) seeds the default branch on first variant write', () => {
    const withNum = `<div data-id="root"><ZaPoKa data-id="z-1" data-name="ZaPoKa" curveRadius={14} style={{}} /></div>`;
    const out = setConditionalInstanceProp(withNum, 'z-1', 'ZaPoKa', 'curveRadius', 'Hover', '18');
    expect(out).toContain(`curveRadius={initialVariant === 'Hover' ? 18 : 14}`);
  });
});
