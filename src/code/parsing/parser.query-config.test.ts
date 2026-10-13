import { describe, it, expect } from 'vitest';
import { parseJSXToNodes } from './parser';
import { updateCollectionQueryConfig } from '../generation/cms-gen';

describe('parser query-config and updateCollectionQueryConfig', () => {
  it('parses data-query-config with JSON.stringify call on collection container', () => {
    const code = `
      import tattoos from '@/cms/tattoos.json';
      export default function Page() {
        return (
          <div
            data-id="tattoos-grid"
            data-query-config={JSON.stringify({
              isApiMode: true,
              params: [
                { key: 'filter[category][_eq]', value: 'params.category', isExpression: true },
                { key: 'limit', value: '12' }
              ]
            })}
          >
            {tattoos.map((item) => (
              <div data-id="tattoo-card" key={item.id}>
                <span>{item.name}</span>
              </div>
            ))}
          </div>
        );
      }
    `;

    const nodes = parseJSXToNodes(code);
    const gridNode = nodes.get('tattoos-grid');
    expect(gridNode).toBeDefined();
    expect(gridNode?.collectionList).toBeDefined();
    expect(gridNode?.collectionList?.queryConfig).toEqual({
      isApiMode: true,
      params: [
        { key: 'filter[category][_eq]', value: 'params.category', isExpression: true },
        { key: 'limit', value: '12' },
      ],
    });
  });

  it('parses data-query-config string literal attribute', () => {
    const code = `
      import items from '@/cms/items.json';
      export default function Page() {
        return (
          <div data-id="list" data-query-config='{"isApiMode":true,"params":[{"key":"sort","value":"-date"}]}'>
            {items.map((i) => (
              <div data-id="card" key={i.id} />
            ))}
          </div>
        );
      }
    `;

    const nodes = parseJSXToNodes(code);
    const listNode = nodes.get('list');
    expect(listNode?.collectionList?.queryConfig).toEqual({
      isApiMode: true,
      params: [{ key: 'sort', value: '-date' }],
    });
  });

  it('updateCollectionQueryConfig injects, updates, and removes data-query-config', () => {
    const initialCode = `
      import items from '@/cms/items.json';
      export default function Page() {
        return (
          <div data-id="grid" style={{ display: 'flex' }}>
            {items.map(item => <div data-id="card" key={item.id} />)}
          </div>
        );
      }
    `;

    const config = {
      isApiMode: true,
      params: [{ key: 'limit', value: '20' }],
    };

    const injected = updateCollectionQueryConfig(initialCode, 'grid', config);
    expect(injected).toContain('data-query-config={JSON.stringify({"isApiMode":true,"params":[{"key":"limit","value":"20"}]})}');

    // Round-trip parse
    const nodes = parseJSXToNodes(injected);
    expect(nodes.get('grid')?.collectionList?.queryConfig).toEqual(config);

    // Update with different params
    const updatedConfig = {
      isApiMode: true,
      params: [{ key: 'search', value: 'neon' }],
    };
    const updated = updateCollectionQueryConfig(injected, 'grid', updatedConfig);
    expect(updated).toContain('data-query-config={JSON.stringify({"isApiMode":true,"params":[{"key":"search","value":"neon"}]})}');
    expect((updated.match(/data-query-config=/g) || []).length).toBe(1);

    // Remove
    const removed = updateCollectionQueryConfig(updated, 'grid', null);
    expect(removed).not.toContain('data-query-config');
  });
});
