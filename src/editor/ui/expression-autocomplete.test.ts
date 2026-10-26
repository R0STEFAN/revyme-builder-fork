import { describe, it, expect } from 'vitest';
import {
  extractActiveExpression,
  parseExpressionPath,
  resolveTarget,
  getAutocompleteSuggestions,
} from './expression-autocomplete';

describe('expression-autocomplete', () => {
  describe('extractActiveExpression', () => {
    it('extracts bare identifier and member paths', () => {
      expect(extractActiveExpression('placements').expression).toBe('placements');
      expect(extractActiveExpression('placements.').expression).toBe('placements.');
      expect(extractActiveExpression('placements[0].').expression).toBe('placements[0].');
      expect(extractActiveExpression('placements[0].tit').expression).toBe('placements[0].tit');
    });

    it('extracts after operators and spaces', () => {
      expect(extractActiveExpression('1 + placements.').expression).toBe('placements.');
      expect(extractActiveExpression('Math.max(10, posts.').expression).toBe('posts.');
      expect(extractActiveExpression('flag ? item.na : other.').expression).toBe('other.');
    });

    it('extracts inside template literals', () => {
      expect(extractActiveExpression('`Category: ${params.').expression).toBe('params.');
      expect(extractActiveExpression('`Item: ${item.title} and ${placements.').expression).toBe('placements.');
    });
  });

  describe('parseExpressionPath', () => {
    it('parses array dot path', () => {
      const parsed = parseExpressionPath('placements.');
      expect(parsed).toEqual({
        root: 'placements',
        steps: [],
        hasTrailingDot: true,
        query: '',
      });
    });

    it('parses indexed array path', () => {
      const parsed = parseExpressionPath('placements[0].');
      expect(parsed).toEqual({
        root: 'placements',
        steps: [0],
        hasTrailingDot: true,
        query: '',
      });
    });

    it('parses indexed array path with query', () => {
      const parsed = parseExpressionPath('placements[0].tit');
      expect(parsed).toEqual({
        root: 'placements',
        steps: [0],
        hasTrailingDot: true,
        query: 'tit',
      });
    });

    it('handles dot-bracket syntax placements.[0].', () => {
      const parsed = parseExpressionPath('placements.[0].');
      expect(parsed).toEqual({
        root: 'placements',
        steps: [0],
        hasTrailingDot: true,
        query: '',
      });
    });
  });

  describe('resolveTarget', () => {
    const scope = {
      item: { id: 'p1', title: 'Hello World', count: 42 },
      placements: [
        { id: 'ad-1', title: 'Top Banner', active: true },
        { id: 'ad-2', title: 'Sidebar', active: false },
      ],
      params: { category: 'tech' },
    };

    it('resolves root identifiers', () => {
      expect(resolveTarget('item', [], scope)).toBe(scope.item);
      expect(resolveTarget('placements', [], scope)).toBe(scope.placements);
      expect(resolveTarget('params', [], scope)).toBe(scope.params);
      expect(resolveTarget('unknown', [], scope)).toBeUndefined();
    });

    it('resolves nested array index and properties', () => {
      expect(resolveTarget('placements', [0], scope)).toBe(scope.placements[0]);
      expect(resolveTarget('placements', [0, 'title'], scope)).toBe('Top Banner');
      expect(resolveTarget('placements', [99], scope)).toBeUndefined();
    });
  });

  describe('getAutocompleteSuggestions', () => {
    const scope = {
      item: { id: 'post-1', title: 'Post Title', slug: 'post-title' },
      placements: [
        { id: 'hero-slot', name: 'Hero Slot', position: 'top' },
        { id: 'footer-slot', name: 'Footer Slot', position: 'bottom' },
      ],
      params: { category: 'engineering', slug: 'awesome-post' },
    };

    it('suggests [0], length, and array methods for array targets and consumes dot', () => {
      const text = 'placements.';
      const suggestions = getAutocompleteSuggestions({
        text,
        cursorPos: text.length,
        scope,
      });

      // Must suggest [0]
      const index0 = suggestions.find(s => s.label === '[0]');
      expect(index0).toBeDefined();
      expect(index0?.type).toBe('index');
      expect(index0?.detail).toBe('Hero Slot');

      // Crucial requirement: selecting [0] must consume the trailing dot!
      // text is "placements."
      // replaceFrom should be at '.' index (10), replaceTo is (11)
      const transformed =
        text.slice(0, index0!.replaceFrom) + index0!.insertText + text.slice(index0!.replaceTo);
      expect(transformed).toBe('placements[0]');

      // Length and methods
      expect(suggestions.some(s => s.label === 'length')).toBe(true);
      expect(suggestions.some(s => s.label === 'filter')).toBe(true);
      expect(suggestions.some(s => s.label === 'find')).toBe(true);
    });

    it('consumes dot when typing digit after dot like placements.0', () => {
      const text = 'placements.0';
      const suggestions = getAutocompleteSuggestions({
        text,
        cursorPos: text.length,
        scope,
      });

      const index0 = suggestions.find(s => s.label === '[0]');
      expect(index0).toBeDefined();
      const transformed =
        text.slice(0, index0!.replaceFrom) + index0!.insertText + text.slice(index0!.replaceTo);
      expect(transformed).toBe('placements[0]');
    });

    it('suggests properties of indexed array element', () => {
      const text = 'placements[0].';
      const suggestions = getAutocompleteSuggestions({
        text,
        cursorPos: text.length,
        scope,
      });

      const idSugg = suggestions.find(s => s.label === 'id');
      const nameSugg = suggestions.find(s => s.label === 'name');
      const posSugg = suggestions.find(s => s.label === 'position');

      expect(idSugg).toBeDefined();
      expect(idSugg?.detail).toBe('"hero-slot"');
      expect(nameSugg).toBeDefined();
      expect(nameSugg?.detail).toBe('"Hero Slot"');
      expect(posSugg).toBeDefined();

      // Selecting property appends after dot
      const transformed =
        text.slice(0, nameSugg!.replaceFrom) + nameSugg!.insertText + text.slice(nameSugg!.replaceTo);
      expect(transformed).toBe('placements[0].name');
    });

    it('filters properties when typing after dot', () => {
      const text = 'placements[0].na';
      const suggestions = getAutocompleteSuggestions({
        text,
        cursorPos: text.length,
        scope,
      });

      expect(suggestions.length).toBe(1);
      expect(suggestions[0].label).toBe('name');

      // Replaces "na" with "name"
      const transformed =
        text.slice(0, suggestions[0].replaceFrom) + suggestions[0].insertText + text.slice(suggestions[0].replaceTo);
      expect(transformed).toBe('placements[0].name');
    });

    it('suggests string methods and length when target is a string', () => {
      const text = 'item.title.';
      const suggestions = getAutocompleteSuggestions({
        text,
        cursorPos: text.length,
        scope,
      });

      expect(suggestions.some(s => s.label === 'toLowerCase')).toBe(true);
      expect(suggestions.some(s => s.label === 'trim')).toBe(true);
      expect(suggestions.some(s => s.label === 'length')).toBe(true);
    });

    it('suggests route params when typing params.', () => {
      const text = 'params.';
      const suggestions = getAutocompleteSuggestions({
        text,
        cursorPos: text.length,
        scope,
      });

      expect(suggestions.some(s => s.label === 'category')).toBe(true);
      expect(suggestions.some(s => s.label === 'slug')).toBe(true);
    });

    it('suggests root identifiers when typing partial word', () => {
      const text = 'place';
      const suggestions = getAutocompleteSuggestions({
        text,
        cursorPos: text.length,
        scope,
      });

      const sugg = suggestions.find(s => s.label === 'placements');
      expect(sugg).toBeDefined();
      expect(sugg?.type).toBe('collection');
    });
  });
});
