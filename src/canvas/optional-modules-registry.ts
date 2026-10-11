// optional-modules-registry.ts — Async loader and registry for heavy 3D modules (Three, Spline).
// Deduplicates concurrent in-flight requests, evicts on error to allow retry,
// and normalizes namespaces for CommonJS and ESM consumers.

import { trace } from '@/shared/debug-trace';

export type OptionalModuleSpecifier =
  | 'three'
  | 'three/examples/jsm/loaders/GLTFLoader.js'
  | '@splinetool/runtime';

export type ModuleLoader = (specifier: OptionalModuleSpecifier) => Promise<any>;

let customLoader: ModuleLoader | null = null;

export function setCustomModuleLoader(loader: ModuleLoader | null) {
  customLoader = loader;
}

const defaultLoader: ModuleLoader = async (specifier: OptionalModuleSpecifier) => {
  switch (specifier) {
    case 'three': {
      const mod = await import('three');
      return { ...mod, default: (mod as any).default ?? mod, __esModule: true };
    }
    case 'three/examples/jsm/loaders/GLTFLoader.js': {
      // @ts-ignore
      const mod = await import('three/examples/jsm/loaders/GLTFLoader.js');
      return { ...mod, default: (mod as any).default ?? mod, __esModule: true };
    }
    case '@splinetool/runtime': {
      const mod = await import('@splinetool/runtime');
      return { ...mod, default: (mod as any).default ?? mod, __esModule: true };
    }
    default:
      throw new Error(`Unsupported optional module: ${specifier}`);
  }
};

const moduleCache = new Map<string, Promise<any>>();
const loadedModules = new Map<string, any>();

export function isOptionalModuleLoaded(specifier: string): boolean {
  return loadedModules.has(specifier);
}

export function getLoadedOptionalModule(specifier: string): any {
  return loadedModules.get(specifier);
}

export function loadOptionalModule(specifier: string): Promise<any> {
  if (loadedModules.has(specifier)) {
    return Promise.resolve(loadedModules.get(specifier));
  }

  const existing = moduleCache.get(specifier);
  if (existing) {
    return existing;
  }

  const loader = customLoader || defaultLoader;
  trace.action('optional-modules:load-start', { specifier });

  const promise = (async () => {
    try {
      const mod = await loader(specifier as OptionalModuleSpecifier);
      loadedModules.set(specifier, mod);
      trace.action('optional-modules:load-success', { specifier });
      return mod;
    } catch (err) {
      moduleCache.delete(specifier);
      loadedModules.delete(specifier);
      trace.error('optional-modules:load-error', { specifier, err });
      throw err;
    }
  })();

  moduleCache.set(specifier, promise);
  return promise;
}

export function preloadOptionalModules(specifiers: string[]): Promise<any[]> {
  return Promise.all(specifiers.map(loadOptionalModule));
}

export function detectRequiredOptionalModules(code: string): string[] {
  const needed: string[] = [];
  if (/\b(?:from|import)\s*['"]three['"]/.test(code)) {
    needed.push('three');
  }
  if (/\b(?:from|import)\s*['"]three\/examples\/jsm\/loaders\/GLTFLoader(?:\.js)?['"]/.test(code)) {
    if (!needed.includes('three')) needed.push('three');
    needed.push('three/examples/jsm/loaders/GLTFLoader.js');
  }
  if (/\b(?:from|import)\s*['"]@splinetool\/runtime['"]/.test(code)) {
    needed.push('@splinetool/runtime');
  }
  return needed;
}

export function resetOptionalModuleRegistryForTesting() {
  moduleCache.clear();
  loadedModules.clear();
  customLoader = null;
}
