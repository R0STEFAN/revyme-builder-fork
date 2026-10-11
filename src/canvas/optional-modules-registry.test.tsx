import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react';
import {
  loadOptionalModule,
  setCustomModuleLoader,
  resetOptionalModuleRegistryForTesting,
  isOptionalModuleLoaded,
} from './optional-modules-registry';
import { compileCodeComponent } from './code-component-runtime';
import { checkFile } from '@/code/oracle/check-file';
import { SPLINE_SCENE_COMPONENT } from '@/code/project/default-code-components/SplineScene';
import { parseComponentControlsMeta } from '@/code/components/controls-parser';

afterEach(() => {
  cleanup();
  resetOptionalModuleRegistryForTesting();
});

describe('Optional modules registry (AUD-16)', () => {
  it('loads modules and deduplicates concurrent in-flight requests', async () => {
    let loadCount = 0;
    setCustomModuleLoader(async (specifier) => {
      loadCount++;
      await new Promise((r) => setTimeout(r, 20));
      return { specifier, mockExport: true };
    });

    const [p1, p2] = [loadOptionalModule('three'), loadOptionalModule('three')];
    expect(p1).toBe(p2); // Same in-flight promise

    const [mod1, mod2] = await Promise.all([p1, p2]);
    expect(mod1).toEqual({ specifier: 'three', mockExport: true });
    expect(mod2).toBe(mod1);
    expect(loadCount).toBe(1);
    expect(isOptionalModuleLoaded('three')).toBe(true);
  });

  it('evicts failed loads from cache to permit retry', async () => {
    let attempts = 0;
    setCustomModuleLoader(async (specifier) => {
      attempts++;
      if (attempts === 1) throw new Error('Network failure');
      return { specifier, success: true };
    });

    await expect(loadOptionalModule('@splinetool/runtime')).rejects.toThrow('Network failure');
    expect(isOptionalModuleLoaded('@splinetool/runtime')).toBe(false);

    // Second attempt succeeds
    const mod = await loadOptionalModule('@splinetool/runtime');
    expect(mod).toEqual({ specifier: '@splinetool/runtime', success: true });
    expect(attempts).toBe(2);
  });

  it('static three import component renders loading state, then content once ready', async () => {
    let resolveThree: (mod: any) => void;
    setCustomModuleLoader((specifier) => {
      if (specifier === 'three') {
        return new Promise((r) => {
          resolveThree = r;
        });
      }
      return Promise.resolve({ specifier });
    });

    const testComponentCode = `
import React from 'react';
import * as THREE from 'three';

export default function ThreeBox() {
  return <div data-testid="three-box">THREE version: {THREE.REVISION || 'mock'}</div>;
}
`;

    const Comp = compileCodeComponent(testComponentCode, 'ThreeBox', { skipCache: true });
    expect(Comp).not.toBeNull();

    render(React.createElement(Comp!));
    expect(screen.getByText(/loading 3d/i)).toBeTruthy();

    await act(async () => {
      resolveThree!({ REVISION: '186', default: { REVISION: '186' } });
    });

    expect(screen.getByTestId('three-box')).toBeTruthy();
    expect(screen.getByText(/THREE version: 186/i)).toBeTruthy();
  });

  it('failed static dependency renders visible error with retry button', async () => {
    let fail = true;
    setCustomModuleLoader(async () => {
      if (fail) throw new Error('Could not fetch three.js');
      return { REVISION: '186' };
    });

    const testComponentCode = `
import React from 'react';
import * as THREE from 'three';

export default function ThreeBox() {
  return <div data-testid="three-box">Loaded</div>;
}
`;

    const Comp = compileCodeComponent(testComponentCode, 'ThreeBox', { skipCache: true });
    render(React.createElement(Comp!));

    await act(async () => {
      // wait for rejection
      await new Promise((r) => setTimeout(r, 10));
    });

    expect(screen.getByText(/error loading 3d library: could not fetch three.js/i)).toBeTruthy();
    const retryBtn = screen.getByRole('button', { name: /retry/i });
    expect(retryBtn).toBeTruthy();

    // Now allow success and click retry
    fail = false;
    await act(async () => {
      fireEvent.click(retryBtn);
      await new Promise((r) => setTimeout(r, 10));
    });

    expect(screen.getByTestId('three-box')).toBeTruthy();
  });
});

describe('SplineScene controls and oracle compliance (AUD-14, AUD-16)', () => {
  it('cameraX and cameraY are removed from controls metadata', () => {
    const meta = parseComponentControlsMeta(SPLINE_SCENE_COMPONENT);
    expect(meta).not.toBeNull();
    const controls = meta!.controls;
    expect(controls.sceneUrl).toBeDefined();
    expect(controls.cameraX).toBeUndefined();
    expect(controls.cameraY).toBeUndefined();
  });

  it('SPLINE_SCENE_COMPONENT passes CANVAS_FILL_FEEDBACK oracle rule', () => {
    const violations = checkFile(SPLINE_SCENE_COMPONENT, { kind: 'code-component' });
    const fillViolations = violations.filter((v) => v.code === 'CANVAS_FILL_FEEDBACK');
    expect(fillViolations).toHaveLength(0);
  });
});
