import { describe, test, expect } from 'vitest';
import { instanceRootClips, applyInstanceWrapperClipParity } from './style-apply';

describe('instanceRootClips', () => {
  test('any non-visible overflow on the root clips, on either axis', () => {
    for (const overflow of ['hidden', 'clip', 'auto', 'scroll']) expect(instanceRootClips({ overflow })).toBe(true);
    expect(instanceRootClips({ overflowX: 'hidden' })).toBe(true);
    expect(instanceRootClips({ overflowY: 'auto' })).toBe(true);
  });

  test('visible, missing or junk values do not clip', () => {
    expect(instanceRootClips({ overflow: 'visible' })).toBe(false);
    expect(instanceRootClips({})).toBe(false);
    expect(instanceRootClips(null)).toBe(false);
    expect(instanceRootClips(undefined)).toBe(false);
    expect(instanceRootClips({ overflow: '   ' })).toBe(false);
    expect(instanceRootClips({ overflow: 0 as unknown as string })).toBe(false);
  });
});

// The canvas draws an instance as wrapper + root; the live site draws one div.
// The wrapper must give the parent flex layout the same min-size behaviour as
// a clipping root (the AboutPoint collapse find, 2026-07-05) WITHOUT clipping:
// its clip cut the root's own box-shadow flat, which the live site never does
// (the navbar-card shadow report, 2026-09-25).
describe('applyInstanceWrapperClipParity', () => {
  const wrapper = (style = '') => { const el = document.createElement('div'); el.setAttribute('style', style); return el; };

  test('a clipping root: the wrapper stays visible and carries min 0 instead', () => {
    const el = wrapper();
    expect(applyInstanceWrapperClipParity(el, { overflow: 'hidden', boxShadow: '0 4px 8px rgba(0,0,0,.25)' })).toBe(true);
    expect(el.style.overflow).toBe('visible');
    expect(el.style.minWidth).toBe('0px');
    expect(el.style.minHeight).toBe('0px');
  });

  test('a wrapper left clipped by an earlier render is opened up', () => {
    const el = wrapper('overflow: hidden');
    applyInstanceWrapperClipParity(el, { overflow: 'hidden' });
    expect(el.style.overflow).toBe('visible');
  });

  test('a root that does not clip adds nothing', () => {
    const el = wrapper();
    expect(applyInstanceWrapperClipParity(el, { overflow: 'visible' })).toBe(false);
    expect(el.style.overflow).toBe('visible');
    expect(el.style.minWidth).toBe('');
    expect(el.style.minHeight).toBe('');
  });

  test('an instance-set min bound is left alone', () => {
    const el = wrapper('min-width: 280px');
    applyInstanceWrapperClipParity(el, { overflow: 'hidden' });
    expect(el.style.minWidth).toBe('280px');
    expect(el.style.minHeight).toBe('0px');
  });

  test('when the root stops clipping, only the min values this helper set are removed', () => {
    const el = wrapper('min-width: 280px');
    applyInstanceWrapperClipParity(el, { overflow: 'hidden' });
    applyInstanceWrapperClipParity(el, { overflow: 'visible' });
    expect(el.style.minWidth).toBe('280px');
    expect(el.style.minHeight).toBe('');
  });

  test('re-running on a clipping root is stable', () => {
    const el = wrapper();
    applyInstanceWrapperClipParity(el, { overflow: 'hidden' });
    applyInstanceWrapperClipParity(el, { overflow: 'hidden' });
    expect(el.style.minWidth).toBe('0px');
    expect(el.style.minHeight).toBe('0px');
    expect(el.style.overflow).toBe('visible');
  });
});
