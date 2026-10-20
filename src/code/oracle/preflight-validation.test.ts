import { describe, it, expect } from 'vitest';
import { validateStyleInput, validateTagInput } from './preflight-validation';

describe('preflight-validation', () => {
  describe('validateStyleInput', () => {
    it('rejects CSS pseudo-classes', () => {
      expect(validateStyleInput({ ':hover': { color: 'red' } })).toContain('CSS pseudo-class');
      expect(validateStyleInput({ '&:hover': { color: 'red' } })).toContain('CSS pseudo-class');
    });

    it('rejects CSS transitions and animations', () => {
      expect(validateStyleInput({ transition: 'all 0.3s ease' })).toContain('cannot be edited visually');
      expect(validateStyleInput({ animation: 'spin 1s linear infinite' })).toContain('cannot be edited visually');
    });

    it('rejects CSS custom properties', () => {
      expect(validateStyleInput({ '--primary-color': '#ff0000' })).toContain('Custom CSS property');
    });

    it('rejects non-px spacing units', () => {
      expect(validateStyleInput({ padding: '2rem' })).toContain('must be in pixels');
      expect(validateStyleInput({ margin: '10%' })).toContain('must be in pixels');
      expect(validateStyleInput({ borderRadius: '1.5em' })).toContain('must be in pixels');
      expect(validateStyleInput({ padding: '24px' })).toBeNull();
      expect(validateStyleInput({ padding: '0' })).toBeNull();
    });

    it('rejects invalid min/max constraints', () => {
      expect(validateStyleInput({ minHeight: '100vh' })).toContain('Size constraints (min/max)');
      expect(validateStyleInput({ maxWidth: 'calc(100% - 20px)' })).toContain('Size constraints (min/max)');
      expect(validateStyleInput({ minHeight: '400px' })).toBeNull();
      expect(validateStyleInput({ maxWidth: '100%' })).toBeNull();
    });

    it('rejects unit-based lineHeight', () => {
      expect(validateStyleInput({ lineHeight: '24px' })).toContain('unitless multiplier');
      expect(validateStyleInput({ lineHeight: '1.5' })).toBeNull();
    });

    it('rejects simultaneous background color and image', () => {
      expect(validateStyleInput({ backgroundColor: '#fff', backgroundImage: 'url(...)' })).toContain('Cannot set both backgroundColor and backgroundImage');
    });

    it('rejects longhand before shorthand in style object', () => {
      expect(validateStyleInput({ paddingTop: '10px', padding: '20px' })).toContain('Cannot mix longhand property "paddingTop" before shorthand "padding"');
    });

    it('rejects typography properties on container frames', () => {
      expect(validateStyleInput({ fontSize: '24px' }, { isTextNode: false, tagName: 'div' })).toContain('Typography property "fontSize" cannot be placed on container');
      expect(validateStyleInput({ fontSize: '24px' }, { isTextNode: true, tagName: 'p' })).toBeNull();
    });
  });

  describe('validateTagInput', () => {
    it('rejects children added into slot components', () => {
      const err = validateTagInput('div', { type: 'Marquee', id: 'marquee-1' });
      expect(err).toContain('is a slot component');
    });

    it('rejects unsupported HTML tags', () => {
      expect(validateTagInput('ul')).toContain('is not supported by Revyme visual engine');
      expect(validateTagInput('li')).toContain('is not supported by Revyme visual engine');
      expect(validateTagInput('table')).toContain('is not supported by Revyme visual engine');
      expect(validateTagInput('iframe')).toContain('is not supported by Revyme visual engine');
    });

    it('allows valid native tags', () => {
      expect(validateTagInput('div')).toBeNull();
      expect(validateTagInput('section')).toBeNull();
      expect(validateTagInput('h1')).toBeNull();
      expect(validateTagInput('span')).toBeNull();
    });
  });
});
