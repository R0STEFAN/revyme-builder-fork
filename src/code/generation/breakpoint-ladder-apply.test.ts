import { describe, it, expect, vi, afterEach } from 'vitest';
vi.mock('@/shared/debug-trace', () => ({ trace: { action: vi.fn(), fn: vi.fn(), error: vi.fn(), dom: vi.fn(), state: vi.fn() } }));
import { resizeBreakpointInCode, addBreakpointToCode, removeBreakpointFromCode } from './breakpoint-ladder-apply';
import { migrateFileToStartBreakpoints } from '@/code/project/breakpoint-start-migration';
import { parseCanvasConfig } from '@/code/project/canvas-config';
import { resolveAll, diffResolutions } from '@/code/project/breakpoint-proof';
import { syncViewportWidths } from '@/code/stores/viewport-store';
import { renderWidth, type ViewportConfig } from '@/shared/types';

// A classic 1440 / 768 / 375 page with bands, an instance, per-breakpoint text and an overlay —
// migrated first, so every edit below starts from a real start-model page.
const CLASSIC = `/** @canvas {
  "viewports": [
    { "id": "desktop", "label": "Desktop", "width": 1440, "isPrimary": true, "order": 0 },
    { "id": "tablet", "label": "Tablet", "width": 768, "isPrimary": false, "order": 1 },
    { "id": "mobile", "label": "Mobile", "width": 375, "isPrimary": false, "order": 2 }
  ],
  "positions": { "desktop": { "x": 0, "y": 0 }, "tablet": { "x": 1600, "y": 0 }, "mobile": { "x": 2500, "y": 0 } }
} */
function useResponsiveText(p, o, w) { return p; }
export default function P() {
  return <div data-id="root">
    <style>{\`
    @media (max-width: 768px) and (min-width: 375.02px) {
      [data-id="a"] { color: green !important; }
    }
    @media (max-width: 375px) {
      [data-id="a"] { color: red !important; }
    }
  \`}</style>
    <h1 data-id="a">{useResponsiveText("Hello", {768: "Hi tablet", 375: "Hi phone"}, [1440, 768, 375])}</h1>
    <Card data-id="c" data-responsive='{"768":{"initialVariant":"t"},"375":{"initialVariant":"m"},"_bp":[375,768,1440]}' />
    <div data-id="ov" data-overlay='{"side":"bottom","responsive":{"768":{"side":"top"},"375":{"side":"left"}},"responsiveBp":[375,768,1440]}'>x</div>
  </div>;
}
`;
const START = migrateFileToStartBreakpoints(CLASSIC).code;
const vpsOf = (code: string) => parseCanvasConfig(code)!.viewports as ViewportConfig[];
const at = (code: string, w: number) => resolveAll(code, w);
const same = (a: string, wa: number, b: string, wb: number) => expect(diffResolutions(at(a, wa), at(b, wb))).toEqual([]);

afterEach(() => syncViewportWidths({}));

describe('start-model breakpoint edits on a real page', () => {
  it('moving tablet\'s start to 810: every tile looks the same, 800 now shows mobile', () => {
    const { code, viewports } = resizeBreakpointInCode(START, vpsOf(START), 'tablet', 810);
    expect(viewports.map((v) => [v.id, v.width, v.designWidth])).toEqual([['desktop', 1440, undefined], ['tablet', 1439, 810], ['mobile', 809, 375]]);
    same(START, 768, code, 810);                    // the tablet tile, drawn at its new start
    same(START, 375, code, 375);
    same(START, 1440, code, 1440);
    same(START, 375, code, 800);                    // 800 is mobile's range now
    expect(parseCanvasConfig(code)!.viewports.find((v) => v.id === 'tablet')!.designWidth).toBe(810);
  });

  it('adding 1024: the new tile opens looking like 1024 did; the others are unchanged', () => {
    const { code, viewports } = addBreakpointToCode(START, vpsOf(START), { id: 'laptop', label: 'Laptop', width: 1024, isPrimary: false, order: 3 } as ViewportConfig, { x: 3000, y: 0 });
    expect(viewports.find((v) => v.id === 'laptop')).toMatchObject({ width: 1439, designWidth: 1024 });
    expect(viewports.find((v) => v.id === 'tablet')).toMatchObject({ width: 1023, designWidth: 768 });
    same(START, 1024, code, 1024);
    for (const vp of vpsOf(START)) same(START, renderWidth(vp), code, renderWidth(vp));
    expect(parseCanvasConfig(code)!.positions.laptop).toEqual({ x: 3000, y: 0 });
  });

  it('adding 1920 above desktop: desktop ends at 1919, 1920+ opens on the base design', () => {
    const { code, viewports } = addBreakpointToCode(START, vpsOf(START), { id: 'hd', label: 'HD', width: 1920, isPrimary: false, order: 3 } as ViewportConfig, { x: 4000, y: 0 });
    expect(viewports.find((v) => v.id === 'desktop')).toMatchObject({ width: 1919, designWidth: 1440 });
    expect(viewports.find((v) => v.id === 'hd')).toMatchObject({ width: 100000, designWidth: 1920 });
    same(START, 1920, code, 1920);
    for (const vp of vpsOf(START)) same(START, renderWidth(vp), code, renderWidth(vp));
  });

  it('removing tablet: mobile takes its range, nothing of tablet\'s leaks into it', () => {
    const { code, viewports } = removeBreakpointFromCode(START, vpsOf(START), 'tablet');
    expect(viewports.map((v) => [v.id, v.width, v.designWidth])).toEqual([['desktop', 1440, undefined], ['mobile', 1439, 375]]);
    same(START, 375, code, 375);
    same(START, 1440, code, 1440);
    same(START, 375, code, 1000);                   // 1000 follows mobile now
    expect(code).not.toContain('Hi tablet');
    expect(code).not.toContain('"t"');
  });

  it('removing mobile: tablet now covers everything below it', () => {
    const { code } = removeBreakpointFromCode(START, vpsOf(START), 'mobile');
    same(START, 768, code, 768);
    same(START, 768, code, 375);                    // no floor left under tablet
    expect(code).not.toContain('Hi phone');
  });

  it('a start dragged past its neighbour re-orders cleanly', () => {
    const { code, viewports } = resizeBreakpointInCode(START, vpsOf(START), 'tablet', 300);
    expect(viewports.map((v) => [v.id, v.width, v.designWidth])).toEqual([['desktop', 1440, undefined], ['tablet', 374, 300], ['mobile', 1439, 375]]);
    same(START, 768, code, 300);                    // tablet's look, now at 300 and below
    same(START, 375, code, 375);                    // mobile's look, now 375–1439
    expect(code).not.toMatch(/10000[1-9]/);         // no parking width left behind
  });
});
