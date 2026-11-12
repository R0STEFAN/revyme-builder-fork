// transform-field-value.test.ts — the Transform popup's neutral-value collapse.
//
// A transform prop at its neutral value (rotate/skew/perspective 0, scale 1)
// renders identically to the prop being ABSENT, so a BASE write drops it and
// keeps the JSX clean. On a SCOPED write that equivalence breaks: an empty value
// means "reset this override", so the variant/replica falls back to the BASE —
// and if the base is rotated, typing 0 reverts to the base angle instead of
// applying 0.
//
// Reported on variant-4 of a master whose default rotates 90°: the Rotate field
// snapped straight back. The trace showed the whole chain —
//   control:update-style {"styles":{"rotate":""}}
//   generator.updateVariantStyleInCode {"variantName":"variant-4","styles":{"rotate":""}}
// — and `rotate: ''` on a non-default variant is read as reset-override, which
// DELETES the key (generator-styles). Third path into the same trap after the
// rotate HANDLE (RotateManager's commitVariantRotation) and the Styles Rotate
// control; see project_variant_rotate_zero_dropped.

import { describe, it, expect } from 'vitest';
import { transformFieldValue, parseTransform, formatTransform } from './TransformControl';

describe('transformFieldValue', () => {
  describe('BASE write (primary viewport / default variant)', () => {
    it('drops the prop at its neutral value', () => {
      expect(transformFieldValue(0, 0, false)).toBe('');   // rotate / skew / perspective
      expect(transformFieldValue(1, 1, false)).toBe('');   // scale
    });

    it('writes a real value otherwise', () => {
      expect(transformFieldValue(90, 0, false)).toBe('90');
      expect(transformFieldValue(1.5, 1, false)).toBe('1.5');
      expect(transformFieldValue(-45, 0, false)).toBe('-45');
    });
  });

  describe('SCOPED write (replica / non-default variant)', () => {
    // The reported bug: this MUST be '0', not ''. An empty value deletes the
    // override and the tile inherits the base's 90°.
    it('writes an EXPLICIT 0 for rotate instead of clearing the override', () => {
      expect(transformFieldValue(0, 0, true)).toBe('0');
    });

    it('writes an EXPLICIT 1 for scale', () => {
      expect(transformFieldValue(1, 1, true)).toBe('1');
    });

    it('is unchanged for non-neutral values', () => {
      expect(transformFieldValue(90, 0, true)).toBe('90');
      expect(transformFieldValue(2, 1, true)).toBe('2');
    });
  });

  it('never returns "0"/"1" as an accidental base value (keeps JSX clean)', () => {
    // Guards the other direction: a base write must not start emitting explicit
    // neutrals, which would litter every element with `rotate: 0`.
    expect(transformFieldValue(0, 0, false)).not.toBe('0');
    expect(transformFieldValue(1, 1, false)).not.toBe('1');
  });

  it('treats -0 as neutral on a base write', () => {
    // parseFloat('-0') === -0, and -0 === 0 in JS — the collapse must still fire.
    expect(transformFieldValue(-0, 0, false)).toBe('');
  });
});

describe('parseTransform & formatTransform (translate support)', () => {
  it('parses translateY(16px)', () => {
    const data = parseTransform('translateY(16px)');
    expect(data.translateY).toBe(16);
    expect(data.translateX).toBe(0);
    expect(data.rest).toBe('');
  });

  it('parses translateX(24px)', () => {
    const data = parseTransform('translateX(24px)');
    expect(data.translateX).toBe(24);
    expect(data.translateY).toBe(0);
  });

  it('parses translate(10px, 20px)', () => {
    const data = parseTransform('translate(10px, 20px)');
    expect(data.translateX).toBe(10);
    expect(data.translateY).toBe(20);
  });

  it('parses translate3d(5px, 15px, 0px)', () => {
    const data = parseTransform('translate3d(5px, 15px, 0px)');
    expect(data.translateX).toBe(5);
    expect(data.translateY).toBe(15);
  });

  it('preserves percentage centering translate(-50%, -50%) in rest', () => {
    const data = parseTransform('translate(-50%, -50%) translateY(16px) rotate(45deg)');
    expect(data.translateY).toBe(16);
    expect(data.rotateZ).toBe(45);
    expect(data.rest).toBe('translate(-50%, -50%)');
  });

  it('formats translateX and translateY cleanly', () => {
    expect(formatTransform({
      translateX: 0, translateY: 16,
      rotateZ: 0, rotateX: 0, rotateY: 0,
      scaleX: 1, scaleY: 1, skewX: 0, skewY: 0,
      perspective: 0, rest: ''
    })).toBe('translateY(16px)');

    expect(formatTransform({
      translateX: 12, translateY: 0,
      rotateZ: 0, rotateX: 0, rotateY: 0,
      scaleX: 1, scaleY: 1, skewX: 0, skewY: 0,
      perspective: 0, rest: ''
    })).toBe('translateX(12px)');

    expect(formatTransform({
      translateX: 10, translateY: 20,
      rotateZ: 0, rotateX: 0, rotateY: 0,
      scaleX: 1, scaleY: 1, skewX: 0, skewY: 0,
      perspective: 0, rest: ''
    })).toBe('translate(10px, 20px)');
  });

  it('preserves rest centering while formatting pixel translates', () => {
    expect(formatTransform({
      translateX: 0, translateY: 16,
      rotateZ: 0, rotateX: 0, rotateY: 0,
      scaleX: 1, scaleY: 1, skewX: 0, skewY: 0,
      perspective: 0, rest: 'translate(-50%, -50%)'
    })).toBe('translate(-50%, -50%) translateY(16px)');
  });
});
