import { describe, it, expect } from 'vitest';
import {
  getItemSlug,
  getItemRecordId,
  getItemDisplayLabel,
  getNestedValue,
  buildDatasetKey,
} from '../cms-accessor';

describe('cms-accessor: getNestedValue', () => {
  it('reads shallow and nested dot notation paths', () => {
    const data = {
      title: 'Post Title',
      author: {
        name: 'Jane Doe',
        contact: {
          email: 'jane@example.com',
        },
      },
    };
    expect(getNestedValue(data, 'title')).toBe('Post Title');
    expect(getNestedValue(data, 'author.name')).toBe('Jane Doe');
    expect(getNestedValue(data, 'author.contact.email')).toBe('jane@example.com');
  });

  it('reads array and bracket notation paths', () => {
    const data = {
      items: [
        { id: 1, name: 'First' },
        { id: 2, name: 'Second' },
      ],
      matrix: [[10, 20], [30, 40]],
    };
    expect(getNestedValue(data, 'items[0].name')).toBe('First');
    expect(getNestedValue(data, 'items[1].id')).toBe(2);
    expect(getNestedValue(data, 'items.0.name')).toBe('First');
    expect(getNestedValue(data, 'matrix[1][0]')).toBe(30);
  });

  it('returns literal property when object has a direct key with dots', () => {
    const data = {
      'author.name': 'Flat Literal Name',
      author: { name: 'Nested Name' },
    };
    expect(getNestedValue(data, 'author.name')).toBe('Flat Literal Name');
  });

  it('safely handles falsy values and null/undefined', () => {
    const data = {
      zero: 0,
      emptyStr: '',
      isFalse: false,
      nullVal: null,
    };
    expect(getNestedValue(data, 'zero')).toBe(0);
    expect(getNestedValue(data, 'emptyStr')).toBe('');
    expect(getNestedValue(data, 'isFalse')).toBe(false);
    expect(getNestedValue(data, 'nullVal')).toBeNull();
    expect(getNestedValue(null, 'any.path')).toBeUndefined();
    expect(getNestedValue(undefined, 'any.path')).toBeUndefined();
    expect(getNestedValue(data, 'nonexistent.deep.field')).toBeUndefined();
    expect(getNestedValue(data, '')).toBe(data);
  });

  it('supports path passed as string array', () => {
    const data = { author: { profile: { age: 30 } } };
    expect(getNestedValue(data, ['author', 'profile', 'age'])).toBe(30);
  });
});

describe('cms-accessor: getItemRecordId', () => {
  it('resolves canonical record id with standard priority', () => {
    expect(getItemRecordId({ _id: 'mongo-1', id: 'sql-1' })).toBe('mongo-1');
    expect(getItemRecordId({ id: 101, _slug: 'slug-1' })).toBe(101);
    expect(getItemRecordId({ _slug: 'local-slug' })).toBe('local-slug');
    expect(getItemRecordId({ slug: 'api-slug' })).toBe('api-slug');
  });

  it('respects custom idField and nested paths', () => {
    const item = {
      custom_pk: 999,
      _id: 'default-id',
      meta: { uuid: 'nested-uuid-123' },
    };
    expect(getItemRecordId(item, 'custom_pk')).toBe(999);
    expect(getItemRecordId(item, 'meta.uuid')).toBe('nested-uuid-123');
    // If custom idField is missing on item, falls back to default id resolution
    expect(getItemRecordId(item, 'missing_field')).toBe('default-id');
  });

  it('safely returns undefined for empty or invalid item', () => {
    expect(getItemRecordId(null)).toBeUndefined();
    expect(getItemRecordId(undefined)).toBeUndefined();
    expect(getItemRecordId({})).toBeUndefined();
  });
});

describe('cms-accessor: getItemSlug', () => {
  it('resolves route slug prioritizing _slug for local items and slug for API items', () => {
    expect(getItemSlug({ _slug: 'local-post', slug: 'api-post' })).toBe('local-post');
    expect(getItemSlug({ slug: 'api-post', id: 42 })).toBe('api-post');
    expect(getItemSlug({ id: 42 })).toBe('42');
    expect(getItemSlug({ _id: 'id-only' })).toBe('id-only');
  });

  it('respects custom slugField and nested slugField', () => {
    const item = {
      permalink: 'custom-route-slug',
      slug: 'default-slug',
      details: { route: 'nested-route' },
    };
    expect(getItemSlug(item, 'permalink')).toBe('custom-route-slug');
    expect(getItemSlug(item, 'details.route')).toBe('nested-route');
    expect(getItemSlug(item, 'nonexistent')).toBe('default-slug');
  });

  it('safely handles null, undefined, or empty objects', () => {
    expect(getItemSlug(null)).toBe('');
    expect(getItemSlug(undefined)).toBe('');
    expect(getItemSlug({})).toBe('');
  });
});

describe('cms-accessor: getItemDisplayLabel', () => {
  it('prioritizes custom labelField, then title, name, label, headline, header', () => {
    expect(getItemDisplayLabel({ title: 'My Article', slug: 'art-1' })).toBe('My Article');
    expect(getItemDisplayLabel({ name: 'Jane Doe', id: 1 })).toBe('Jane Doe');
    expect(getItemDisplayLabel({ label: 'Main Category' })).toBe('Main Category');
    expect(getItemDisplayLabel({ headline: 'Breaking News' })).toBe('Breaking News');
    expect(getItemDisplayLabel({ header: 'Page Header' })).toBe('Page Header');
  });

  it('supports custom labelField and nested labelField', () => {
    const item = {
      title: 'Standard Title',
      custom_header: 'Custom Display',
      author: { full_name: 'Dr. Jane' },
    };
    expect(getItemDisplayLabel(item, 'custom_header')).toBe('Custom Display');
    expect(getItemDisplayLabel(item, 'author.full_name')).toBe('Dr. Jane');
    expect(getItemDisplayLabel(item, 'missing')).toBe('Standard Title');
  });

  it('falls back to non-underscore text keys, then slug, then id', () => {
    expect(getItemDisplayLabel({ customText: 'Arbitrary Text', id: 5 })).toBe('Arbitrary Text');
    expect(getItemDisplayLabel({ slug: 'only-slug', id: 5 })).toBe('only-slug');
    expect(getItemDisplayLabel({ id: 42 })).toBe('42');
  });

  it('safely handles null and empty records', () => {
    expect(getItemDisplayLabel(null)).toBe('');
    expect(getItemDisplayLabel(undefined)).toBe('');
    expect(getItemDisplayLabel({})).toBe('');
  });
});

describe('cms-accessor: buildDatasetKey', () => {
  it('deterministically serializes dataset key with sorted parameters', () => {
    const key1 = buildDatasetKey({
      project: 'proj-1',
      branch: 'main',
      page: 'blog',
      listNodeId: 'node-list',
      queryHash: 'hash-abc',
      params: { limit: 10, offset: 0, search: 'test' },
    });
    const key2 = buildDatasetKey({
      project: 'proj-1',
      branch: 'main',
      page: 'blog',
      listNodeId: 'node-list',
      queryHash: 'hash-abc',
      params: { search: 'test', offset: 0, limit: 10 },
    });
    expect(key1).toBe('proj-1:main:blog:node-list:hash-abc:{"limit":10,"offset":0,"search":"test"}');
    expect(key1).toBe(key2);
  });

  it('handles string params and omitted options gracefully', () => {
    expect(buildDatasetKey({ page: 'posts', params: 'raw-query-string' })).toBe('::posts:::raw-query-string');
    expect(buildDatasetKey({})).toBe(':::::');
  });
});
