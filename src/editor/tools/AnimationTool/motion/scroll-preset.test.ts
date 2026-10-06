import { describe, it, expect } from 'vitest';
import { detectScrollPreset } from './ScrollEditor';

describe('detectScrollPreset', () => {
  it('detects standard presets', () => {
    expect(detectScrollPreset({ opacity: '0' })).toBe('fadeOut');
    expect(detectScrollPreset({ opacity: '0', scale: '0.5' })).toBe('scaleOut');
    expect(detectScrollPreset({ opacity: '0', scale: '0.5', y: '40' })).toBe('scaleOutBottom');
    expect(detectScrollPreset({ opacity: '0', rotateY: '90' })).toBe('flipHorizontal');
    expect(detectScrollPreset({ opacity: '0', rotateX: '90' })).toBe('flipVertical');
    expect(detectScrollPreset({ opacity: '0', y: '-100' })).toBe('slideOutTop');
    expect(detectScrollPreset({ opacity: '0', x: '-100' })).toBe('slideOutLeft');
    expect(detectScrollPreset({ opacity: '0', x: '100' })).toBe('slideOutRight');
    expect(detectScrollPreset({ opacity: '0', y: '100' })).toBe('slideOutBottom');
  });

  it('detects standard presets even with neutral/resting values present', () => {
    expect(detectScrollPreset({ opacity: '0', x: '0', y: '0', rotate: '0' })).toBe('fadeOut');
    expect(detectScrollPreset({ opacity: '0', scale: '0.5', rotateX: '0', rotateY: '0' })).toBe('scaleOut');
  });

  it('detects custom when any property is customized', () => {
    // Modified opacity
    expect(detectScrollPreset({ opacity: '0.7' })).toBe('custom');
    // Added custom offset
    expect(detectScrollPreset({ opacity: '0', x: '50' })).toBe('custom');
    // Custom scale
    expect(detectScrollPreset({ opacity: '0', scale: '0.8' })).toBe('custom');
    // Custom rotation
    expect(detectScrollPreset({ opacity: '0', rotate: '45' })).toBe('custom');
    // Empty object
    expect(detectScrollPreset({})).toBe('custom');
  });
});
