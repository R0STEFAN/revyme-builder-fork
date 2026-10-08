import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { CollectionSchema, FieldDefinition } from '@/shared/types';
import ToolSelect from '../../controls/ToolSelect';
import { buildHierarchicalFields, flattenHierarchicalFields } from './cms-filter-utils';

afterEach(cleanup);

function relation(id: string, target?: string): FieldDefinition {
  return { id, name: id, type: 'multi-reference', referenceCollection: target };
}

function schema(slug: string, fields: FieldDefinition[]): CollectionSchema {
  return { slug, name: slug, fields };
}

const slugField: FieldDefinition = { id: 'slug', name: 'slug', type: 'slug' };

function relatedSchemas(explicit: boolean) {
  const placements = schema('placements', [slugField]);
  const categories = schema('categories', [relation('placementsM2m', explicit ? 'placements' : undefined)]);
  const tattoos = schema('tattoos', [
    relation('categoriesM2m', explicit ? 'categories' : undefined),
    relation('placementsM2m', explicit ? 'placements' : undefined),
  ]);
  return { tattoos, schemas: new Map([tattoos, categories, placements].map(s => [s.slug, s])) };
}

describe('collection filter field hierarchy', () => {
  for (const explicit of [true, false]) {
    it(`keeps nested and root relation paths distinct (${explicit ? 'explicit' : 'inferred'} references)`, () => {
      const { tattoos, schemas } = relatedSchemas(explicit);
      const fields = flattenHierarchicalFields(buildHierarchicalFields(tattoos, schemas));
      expect(fields.find(f => f.label === 'categoriesM2m › placementsM2m › slug')).toEqual({
        fullPath: 'categoriesM2m.placementsM2m.slug',
        label: 'categoriesM2m › placementsM2m › slug',
        type: 'slug',
      });
      expect(fields.filter(f => f.fullPath === 'placementsM2m.slug').map(f => f.label)).toEqual(['placementsM2m › slug']);
      expect(new Set(fields.map(f => f.fullPath)).size).toBe(fields.length);
    });
  }

  it('shows the selected root relation rather than a nested relation in the field control', () => {
    const { tattoos, schemas } = relatedSchemas(true);
    const options = flattenHierarchicalFields(buildHierarchicalFields(tattoos, schemas))
      .map(f => ({ value: f.fullPath, label: f.label }));
    const { container } = render(<ToolSelect value="placementsM2m.slug" onChange={() => {}} options={options} />);
    expect(container.querySelector('select')!.selectedOptions[0].textContent).toBe('placementsM2m › slug');
  });

  it('prefixes every descendant across three relations', () => {
    const countries = schema('countries', [slugField]);
    const placements = schema('placements', [relation('country', 'countries')]);
    const categories = schema('categories', [relation('placementsM2m', 'placements')]);
    const tattoos = schema('tattoos', [relation('categoriesM2m', 'categories')]);
    const schemas = new Map([tattoos, categories, placements, countries].map(s => [s.slug, s]));
    const fields = flattenHierarchicalFields(buildHierarchicalFields(tattoos, schemas));
    expect(fields.find(f => f.label === 'categoriesM2m › placementsM2m › country › slug')?.fullPath)
      .toBe('categoriesM2m.placementsM2m.country.slug');
  });

  it('prefixes schema descendants discovered through a junction ID in sample data', () => {
    const countries = schema('countries', [slugField]);
    const placements = schema('placements', [relation('country', 'countries')]);
    const tattoos = schema('tattoos', [relation('links')]);
    const schemas = new Map([tattoos, placements, countries].map(s => [s.slug, s]));
    const data = new Map([['tattoos', [{ links: [{ placements_id: 'place-1' }] }]]]);
    const fields = flattenHierarchicalFields(buildHierarchicalFields(tattoos, schemas, data));
    expect(fields.find(f => f.label === 'links › placements_id › country › slug')?.fullPath)
      .toBe('links.placements_id.country.slug');
  });

  it('preserves nested object paths discovered in a referenced collection', () => {
    const placements = schema('placements', [{ id: 'metadata', name: 'metadata', type: 'text' }]);
    const tattoos = schema('tattoos', [relation('placementsM2m', 'placements')]);
    const schemas = new Map([tattoos, placements].map(s => [s.slug, s]));
    const data = new Map([['placements', [{ metadata: { location: { slug: 'arm' } } }]]]);
    const fields = flattenHierarchicalFields(buildHierarchicalFields(tattoos, schemas, data));
    expect(fields.find(f => f.label === 'placementsM2m › metadata › location › slug')?.fullPath)
      .toBe('placementsM2m.metadata.location.slug');
  });

  it('stops cyclic references while preserving sibling branches', () => {
    const { tattoos, schemas } = relatedSchemas(true);
    schemas.get('placements')!.fields.push(relation('tattoos', 'tattoos'));
    const fields = flattenHierarchicalFields(buildHierarchicalFields(tattoos, schemas));
    expect(fields.some(f => f.fullPath === 'categoriesM2m.placementsM2m.slug')).toBe(true);
    expect(fields.some(f => f.fullPath === 'placementsM2m.slug')).toBe(true);
    expect(fields.some(f => f.fullPath.includes('tattoos.categoriesM2m'))).toBe(false);
  });
});
