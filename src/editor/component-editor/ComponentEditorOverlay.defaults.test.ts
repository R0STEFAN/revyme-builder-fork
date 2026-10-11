import { describe, it, expect } from 'vitest';
import { extractControlDefaults, mergePropsWithDefaults } from './ComponentEditorOverlay';
import type { ComponentControlDef } from '@/code/components/controls-parser';

describe('ComponentEditorOverlay defaults helper (AUD-10)', () => {
  it('recursively flattens defaults for nested group controls', () => {
    const controls: Record<string, ComponentControlDef> = {
      title: { type: 'text', label: 'Title', default: 'Default Title' },
      effects: {
        type: 'group',
        label: 'Effects',
        controls: {
          speed: { type: 'number', label: 'Speed', default: 1 },
          visuals: {
            type: 'group',
            label: 'Visuals',
            controls: {
              blur: { type: 'slider', label: 'Blur', default: 4, min: 0, max: 20 },
            },
          },
        },
      },
    };

    const defaults = extractControlDefaults(controls);
    expect(defaults).toEqual({
      title: 'Default Title',
      speed: 1,
      blur: 4,
    });
  });

  it('mergePropsWithDefaults preserves already-set values including false, 0, and empty strings', () => {
    const controls: Record<string, ComponentControlDef> = {
      radius: { type: 'number', label: 'Radius', default: 16 },
      enabled: { type: 'toggle', label: 'Enabled', default: true },
      subtitle: { type: 'text', label: 'Subtitle', default: 'Default Subtitle' },
      settings: {
        type: 'group',
        label: 'Settings',
        controls: {
          zoom: { type: 'number', label: 'Zoom', default: 2 },
          active: { type: 'toggle', label: 'Active', default: true },
        },
      },
    };

    const prevProps = {
      radius: 0,
      enabled: false,
      subtitle: '',
      active: false,
    };

    const merged = mergePropsWithDefaults(controls, prevProps);

    expect(merged.radius).toBe(0);
    expect(merged.enabled).toBe(false);
    expect(merged.subtitle).toBe('');
    expect(merged.active).toBe(false);
    expect(merged.zoom).toBe(2);
  });
});
