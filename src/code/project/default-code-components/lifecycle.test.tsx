/** @vitest-environment jsdom */
import React from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { transform } from '@babel/standalone';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkFile } from '@/code/oracle/check-file';
import { IMAGE_SEQUENCE_COMPONENT } from './ImageSequence';
import { MODEL_VIEWER_COMPONENT } from './ModelViewer';
import { PARTICLE_FIELD_COMPONENT } from './ParticleField';

function mountTemplate(source: string, deps: Record<string, unknown> = {}, isStatic = false) {
  const prepared = source
    .replace("import('three')", "Promise.resolve(require('three'))")
    .replace("import('three/examples/jsm/loaders/GLTFLoader.js')", "Promise.resolve(require('three/examples/jsm/loaders/GLTFLoader.js'))");
  const output = transform(prepared, {
    filename: 'template.tsx', presets: ['react', 'typescript'], plugins: ['transform-modules-commonjs'],
  });
  const module = { exports: {} as { default: React.ComponentType<any> } };
  const requireDependency = (name: string) => name === 'react' ? React
    : name === '@revyme/runtime' ? { withResponsiveProps: (component: unknown) => component, useStaticCanvas: () => isStatic }
    : deps[name];
  new Function('require', 'module', 'exports', 'React', output.code!)(requireDependency, module, module.exports, React);
  return module.exports.default;
}

function imageFixture() {
  const images: FakeImage[] = [];
  class FakeImage {
    private url = '';
    complete = false;
    naturalWidth = 100;
    naturalHeight = 100;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    get src() { return this.url; }
    set src(value: string) { this.url = value; }
    constructor() { images.push(this); }
    succeed() { this.complete = true; this.onload?.(); }
    fail() { this.complete = true; this.naturalWidth = 0; this.onerror?.(); }
  }
  vi.stubGlobal('Image', FakeImage);
  const ctx = { drawImage: vi.fn(), clearRect: vi.fn() };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as any);
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(200);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(100);
  return { images, ctx };
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('ImageSequence exported template', () => {
  it('redraws the replacement and ignores stale callbacks from the old set', async () => {
    const { images, ctx } = imageFixture();
    const Component = mountTemplate(IMAGE_SEQUENCE_COMPONENT);
    const view = render(<Component folder="/A" totalFrames={1} />);
    const oldCallback = images[0].onload!;
    view.rerender(<Component folder="/B" totalFrames={1} />);
    await act(async () => oldCallback());
    expect(view.getByText('Loading frames...')).toBeTruthy();
    await act(async () => images[1].succeed());
    expect(ctx.drawImage.mock.lastCall?.[0]).toBe(images[1]);
  });

  it('requests a single uploaded URL verbatim and handles a synchronous cached load', async () => {
    const { images, ctx } = imageFixture();
    const OriginalImage = globalThis.Image;
    vi.stubGlobal('Image', class extends (OriginalImage as any) {
      set src(value: string) { super.src = value; this.succeed(); }
      get src() { return super.src; }
    });
    const Component = mountTemplate(IMAGE_SEQUENCE_COMPONENT);
    const view = render(<Component folder="https://cdn.example/frame.webp" totalFrames={5} />);
    await act(async () => {});
    expect(images.map((image) => image.src)).toEqual(['https://cdn.example/frame.webp']);
    expect(ctx.drawImage.mock.lastCall?.[0]).toBe(images[0]);
    expect(view.queryByText('Loading frames...')).toBeNull();
  });

  it('reports all failures, but draws a successful frame when another fails', async () => {
    const { images, ctx } = imageFixture();
    const Component = mountTemplate(IMAGE_SEQUENCE_COMPONENT);
    const view = render(<Component folder="/A" totalFrames={2} frame={0} />);
    await act(async () => { images[0].fail(); images[1].fail(); });
    expect(view.getByText('Failed to load frames')).toBeTruthy();
    view.rerender(<Component folder="/B" totalFrames={2} frame={0} />);
    await act(async () => { images[2].fail(); images[3].succeed(); });
    expect(view.queryByText('Failed to load frames')).toBeNull();
    expect(ctx.drawImage.mock.lastCall?.[0]).toBe(images[3]);
  });

  it('clears old pixels for empty input and uses contain fit for data-frame and resize draws', async () => {
    const { images, ctx } = imageFixture();
    const Component = mountTemplate(IMAGE_SEQUENCE_COMPONENT);
    const view = render(<Component folder="/A" totalFrames={2} fit="contain" />);
    await act(async () => { images[0].succeed(); images[1].succeed(); });
    const root = view.container.firstElementChild!;
    await act(async () => root.setAttribute('data-frame', '1'));
    expect(ctx.drawImage.mock.lastCall?.slice(5)).toEqual([50, 0, 100, 100]);
    const clearsBeforeEmpty = ctx.clearRect.mock.calls.length;
    const drawsBeforeEmpty = ctx.drawImage.mock.calls.length;
    view.rerender(<Component folder="" totalFrames={2} fit="contain" />);
    expect(ctx.clearRect.mock.calls.length).toBeGreaterThan(clearsBeforeEmpty);
    expect(ctx.drawImage).toHaveBeenCalledTimes(drawsBeforeEmpty);
    expect(view.queryByText('Loading frames...')).toBeNull();
  });

  it('keeps a data-frame selected before readiness through load completion, fit and resize', async () => {
    const { images, ctx } = imageFixture();
    let resize!: () => void;
    vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { resize = callback; } observe() {} disconnect() {} });
    const Component = mountTemplate(IMAGE_SEQUENCE_COMPONENT);
    const view = render(<Component folder="/A" totalFrames={2} frame={0} fit="contain" />);
    await act(async () => view.container.firstElementChild!.setAttribute('data-frame', '1'));
    await act(async () => { images[1].succeed(); images[0].succeed(); });
    expect(ctx.drawImage.mock.lastCall?.[0]).toBe(images[1]);
    view.rerender(<Component folder="/A" totalFrames={2} frame={0} fit="cover" />);
    expect(ctx.drawImage.mock.lastCall?.[0]).toBe(images[1]);
    act(() => resize());
    expect(ctx.drawImage.mock.lastCall?.[0]).toBe(images[1]);
  });

  it('applies cover and fill to scroll, resize and manual frame draws', async () => {
    const { images, ctx } = imageFixture();
    const callbacks = new Map<number, FrameRequestCallback>();
    let nextRaf = 0;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callbacks.set(++nextRaf, callback); return nextRaf; });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => callbacks.delete(id));
    let resize!: () => void;
    vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { resize = callback; } observe() {} disconnect() {} });
    const Component = mountTemplate(IMAGE_SEQUENCE_COMPONENT);
    const view = render(<Component folder="/A" totalFrames={2} fit="cover" scrollDriven />);
    await act(async () => { images[0].succeed(); images[1].succeed(); });
    act(() => { for (const [id, callback] of [...callbacks]) { callbacks.delete(id); callback(16); } });
    expect(ctx.drawImage.mock.lastCall?.[0]).toBe(images[1]);
    expect(ctx.drawImage.mock.lastCall?.slice(5)).toEqual([0, -50, 200, 200]);
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(300);
    act(() => resize());
    expect(ctx.drawImage.mock.lastCall?.slice(5)).toEqual([0, -100, 300, 300]);
    view.rerender(<Component folder="/A" totalFrames={2} fit="fill" scrollDriven />);
    expect(ctx.drawImage.mock.lastCall?.slice(5)).toEqual([0, 0, 300, 100]);
    await act(async () => view.container.firstElementChild!.setAttribute('data-frame', '0'));
    act(() => window.dispatchEvent(new Event('scroll')));
    act(() => { for (const [id, callback] of [...callbacks]) { callbacks.delete(id); callback(16); } });
    expect(ctx.drawImage.mock.lastCall?.[0]).toBe(images[0]);
    view.rerender(<Component folder="/A" totalFrames={2} frame={1} fit="fill" scrollDriven />);
    expect(ctx.drawImage.mock.lastCall?.[0]).toBe(images[0]);
    expect(ctx.drawImage.mock.lastCall?.slice(5)).toEqual([0, 0, 300, 100]);
    await act(async () => view.container.firstElementChild!.removeAttribute('data-frame'));
    act(() => window.dispatchEvent(new Event('scroll')));
    act(() => { for (const [id, callback] of [...callbacks]) { callbacks.delete(id); callback(16); } });
    expect(ctx.drawImage.mock.lastCall?.[0]).toBe(images[1]);
  });

  it('does not schedule scroll animation in static canvas mode', async () => {
    const { images } = imageFixture();
    const raf = vi.fn();
    vi.stubGlobal('requestAnimationFrame', raf);
    const Component = mountTemplate(IMAGE_SEQUENCE_COMPONENT, {}, true);
    const view = render(<Component folder="/A" totalFrames={2} scrollDriven />);
    const drawImage = vi.mocked(view.container.querySelector('canvas')!.getContext('2d')!.drawImage);
    await act(async () => images[1].succeed());
    expect(drawImage).toHaveBeenCalledTimes(1);
    expect(drawImage.mock.lastCall?.[0]).toBe(images[1]);
    expect(view.getByText('Loading frames...')).toBeTruthy();
    await act(async () => images[0].succeed());
    expect(drawImage).toHaveBeenCalledTimes(1);
    expect(raf).not.toHaveBeenCalled();
    view.rerender(<Component folder="/A" totalFrames={2} frame={1} scrollDriven />);
    expect(drawImage.mock.lastCall?.[0]).toBe(images[1]);
    view.rerender(<Component folder="/A" totalFrames={2} frame={0} scrollDriven />);
    expect(drawImage.mock.lastCall?.[0]).toBe(images[0]);
  });
});

function modelFixture() {
  const cameras: any[] = [], lights: any[] = [], renderers: any[] = [], loads: any[] = [];
  const raf = new Map<number, FrameRequestCallback>();
  const resizeObservers: Array<{ callback: () => void; disconnect: ReturnType<typeof vi.fn> }> = [];
  let nextRaf = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { raf.set(++nextRaf, callback); return nextRaf; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { raf.delete(id); });
  vi.stubGlobal('ResizeObserver', class {
    disconnect = vi.fn();
    observe = vi.fn();
    constructor(public callback: () => void) { resizeObservers.push(this); }
  });
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(200);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(100);
  class Camera {
    position = { x: 0, y: 0, z: 0 };
    aspect: number;
    lookAt = vi.fn();
    updateProjectionMatrix = vi.fn();
    constructor(_fov: number, aspect: number) { this.aspect = aspect; cameras.push(this); }
  }
  class Light {
    position = { set: vi.fn() };
    constructor(_color: number, public intensity: number) { lights.push(this); }
  }
  class Renderer {
    domElement = document.createElement('canvas');
    setSize = vi.fn(); setPixelRatio = vi.fn(); setClearColor = vi.fn(); setClearAlpha = vi.fn();
    render = vi.fn(); dispose = vi.fn();
    constructor() { renderers.push(this); }
  }
  const deps = {
    three: {
      Scene: class { add = vi.fn(); remove = vi.fn(); },
      PerspectiveCamera: Camera, WebGLRenderer: Renderer,
      AmbientLight: Light, DirectionalLight: Light,
      Color: class { constructor(public value: string) {} }, Vector3: class {},
      Box3: class { setFromObject() { return this; } getCenter() { return {}; } getSize() { return { length: () => 1 }; } },
      SRGBColorSpace: 'srgb', ACESFilmicToneMapping: 'aces',
    },
    'three/examples/jsm/loaders/GLTFLoader.js': {
      GLTFLoader: class { load(path: string, success: (gltf: any) => void, _progress: unknown, failure: (error: Error) => void) {
        loads.push({ path, success, failure });
      } },
    },
  };
  function gltf() {
    const texture = { isTexture: true, dispose: vi.fn() };
    const material = { map: texture, dispose: vi.fn() };
    const geometry = { dispose: vi.fn() };
    const mesh = { geometry, material };
    const scene = {
      position: { sub: vi.fn() }, scale: { setScalar: vi.fn() }, rotation: { y: 0 },
      traverse: (visit: (object: unknown) => void) => { visit(scene); visit(mesh); },
    };
    return { scene, texture, material, geometry };
  }
  function advance() {
    const pending = [...raf.entries()];
    raf.clear();
    for (const [, callback] of pending) callback(16);
  }
  return { deps, cameras, lights, renderers, loads, raf, resizeObservers, gltf, advance };
}

describe('ModelViewer exported template', () => {
  it('places the initial camera after asynchronous setup', async () => {
    const fx = modelFixture();
    const Component = mountTemplate(MODEL_VIEWER_COMPONENT, fx.deps);
    render(<Component modelPath="/A.glb" cameraDistance={5} cameraY={20} />);
    await act(async () => {});
    expect(fx.cameras[0].position.z).toBeCloseTo(4.698, 2);
  });

  it('applies latest camera, lighting, background and rotation when the async model arrives', async () => {
    const fx = modelFixture();
    const Component = mountTemplate(MODEL_VIEWER_COMPONENT, fx.deps);
    const view = render(<Component modelPath="/A.glb" cameraDistance={5} envIntensity={1} />);
    await act(async () => {});
    view.rerender(<Component modelPath="/A.glb" cameraX={90} cameraDistance={7} rotateY={90} envIntensity={2} bgColor="#ff0000" />);
    const model = fx.gltf();
    await act(async () => fx.loads[0].success(model));
    expect(fx.cameras[0].position.x).toBeCloseTo(6.58, 1);
    expect(fx.lights[0].intensity).toBe(0.8);
    expect(fx.renderers[0].setClearColor.mock.lastCall?.[0].value).toBe('#ff0000');
    expect(fx.renderers[0].setClearColor.mock.lastCall?.[1]).toBe(1);
    expect(model.scene.rotation.y).toBeCloseTo(Math.PI / 2);
    expect(view.queryByText('Loading model...')).toBeNull();
  });

  it('updates camera aspect on resize and stops rotation when autoRotate is disabled', async () => {
    const fx = modelFixture();
    const Component = mountTemplate(MODEL_VIEWER_COMPONENT, fx.deps);
    const view = render(<Component modelPath="/A.glb" autoRotate />);
    await act(async () => {});
    const model = fx.gltf();
    await act(async () => fx.loads[0].success(model));
    act(() => { fx.advance(); fx.advance(); });
    expect(model.scene.rotation.y).toBeGreaterThan(0);
    view.rerender(<Component modelPath="/A.glb" autoRotate={false} />);
    const stopped = model.scene.rotation.y;
    act(() => { fx.advance(); fx.advance(); fx.advance(); });
    expect(model.scene.rotation.y).toBe(stopped);
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(300);
    act(() => fx.resizeObservers[0].callback());
    expect(fx.cameras[0].aspect).toBe(3);
    expect(fx.cameras[0].updateProjectionMatrix).toHaveBeenCalled();
    view.unmount();
    expect(fx.raf.size).toBe(0);
  });

  it('disposes late results and active model resources on replacement and unmount', async () => {
    const fx = modelFixture();
    const Component = mountTemplate(MODEL_VIEWER_COMPONENT, fx.deps);
    const view = render(<Component modelPath="/A.glb" />);
    await act(async () => {});
    view.rerender(<Component modelPath="/B.glb" />);
    await act(async () => {});
    const oldModel = fx.gltf();
    await act(async () => fx.loads[0].success(oldModel));
    expect(oldModel.geometry.dispose).toHaveBeenCalledTimes(1);
    expect(oldModel.material.dispose).toHaveBeenCalledTimes(1);
    expect(oldModel.texture.dispose).toHaveBeenCalledTimes(1);
    const currentModel = fx.gltf();
    await act(async () => fx.loads[1].success(currentModel));
    view.unmount();
    expect(currentModel.geometry.dispose).toHaveBeenCalledTimes(1);
    expect(currentModel.material.dispose).toHaveBeenCalledTimes(1);
    expect(currentModel.texture.dispose).toHaveBeenCalledTimes(1);
    expect(fx.renderers.every((renderer) => renderer.dispose.mock.calls.length === 1)).toBe(true);
    expect(fx.raf.size).toBe(0);
  });

  it('resets an error on replacement and disposes a result returned after unmount', async () => {
    const fx = modelFixture();
    const Component = mountTemplate(MODEL_VIEWER_COMPONENT, fx.deps);
    const view = render(<Component modelPath="/bad.glb" />);
    await act(async () => {});
    await act(async () => fx.loads[0].failure(new Error('network')));
    expect(view.getByText('Failed to load model')).toBeTruthy();
    view.rerender(<Component modelPath="/later.glb" />);
    await act(async () => {});
    expect(view.queryByText('Failed to load model')).toBeNull();
    expect(view.getByText('Loading model...')).toBeTruthy();
    view.unmount();
    const late = fx.gltf();
    await act(async () => fx.loads[1].success(late));
    expect(late.geometry.dispose).toHaveBeenCalledTimes(1);
    expect(late.material.dispose).toHaveBeenCalledTimes(1);
    expect(late.texture.dispose).toHaveBeenCalledTimes(1);
  });

  it('ends loading when renderer setup fails for the current model', async () => {
    const fx = modelFixture();
    const deps = {
      ...fx.deps,
      three: { ...fx.deps.three, WebGLRenderer: class { constructor() { throw new Error('WebGL unavailable'); } } },
    };
    const Component = mountTemplate(MODEL_VIEWER_COMPONENT, deps);
    const view = render(<Component modelPath="/A.glb" />);
    await act(async () => {});
    expect(view.getByText('Three.js not available')).toBeTruthy();
    expect(view.queryByText('Loading model...')).toBeNull();
  });

  it('renders one static frame with no animation loop', async () => {
    const fx = modelFixture();
    const Component = mountTemplate(MODEL_VIEWER_COMPONENT, fx.deps, true);
    render(<Component modelPath="/A.glb" autoRotate />);
    await act(async () => {});
    await act(async () => fx.loads[0].success(fx.gltf()));
    expect(fx.renderers[0].render).toHaveBeenCalledTimes(1);
    expect(fx.raf.size).toBe(0);
  });
});

describe('ParticleField exported template', () => {
  it('paints one static frame without running a simulation loop or attaching pointer listeners', () => {
    const ctx = {
      setTransform: vi.fn(), fillRect: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(),
      lineTo: vi.fn(), stroke: vi.fn(), arc: vi.fn(), fill: vi.fn(),
    };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as any);
    const addListener = vi.spyOn(HTMLCanvasElement.prototype, 'addEventListener');
    const raf = vi.fn();
    vi.stubGlobal('requestAnimationFrame', raf);
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(200);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(100);
    const Component = mountTemplate(PARTICLE_FIELD_COMPONENT, {}, true);
    render(<Component particleCount={2} />);
    expect(ctx.fillRect).toHaveBeenCalledTimes(1);
    expect(raf).not.toHaveBeenCalled();
    expect(addListener.mock.calls.some(([type]) => type === 'pointermove' || type === 'pointerleave')).toBe(false);
  });
});

describe('template oracle contract', () => {
  it.each([
    ['ImageSequence', IMAGE_SEQUENCE_COMPONENT],
    ['ModelViewer', MODEL_VIEWER_COMPONENT],
    ['ParticleField', PARTICLE_FIELD_COMPONENT],
  ])('%s passes static canvas and fill rules', (_name, source) => {
    const codes = checkFile(source, { kind: 'code-component' }).map((v) => v.code);
    expect(codes).not.toContain('CODE_COMPONENT_STATIC_FALLBACK');
    expect(codes).not.toContain('CANVAS_FILL_FEEDBACK');
  });
});
