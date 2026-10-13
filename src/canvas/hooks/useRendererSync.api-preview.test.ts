import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  evaluateParamExpression,
  evaluateQueryParamExpressions,
  resolveApiEndpointWithParams,
} from './useRendererSync';
import type { CollectionQueryConfig } from '@/shared/types';
import type { ApiCollectionConfig } from '@/code/project/cms-api-config';

describe('useRendererSync — API CMS Query Parameters Evaluation', () => {
  it('evaluates simple params property access', () => {
    const params = { category: 'tattoos', slug: 'dragon' };
    expect(evaluateParamExpression('params.category', params)).toBe('tattoos');
    expect(evaluateParamExpression('params.slug', params)).toBe('dragon');
    expect(evaluateParamExpression('params.missing', params)).toBe('');
  });

  it('evaluates logical and fallback expressions safely', () => {
    const params = { category: '' };
    expect(evaluateParamExpression('params.category || "all"', params)).toBe('all');
    expect(evaluateParamExpression('params.num ? "yes" : "no"', { num: '1' })).toBe('yes');
  });

  it('handles syntax errors gracefully without throwing', () => {
    expect(evaluateParamExpression('params..invalid++', {})).toBe('');
  });

  it('evaluates full CollectionQueryConfig with static and expression params', () => {
    const queryConfig: CollectionQueryConfig = {
      params: [
        { key: 'filter[category][_eq]', value: 'params.category', isExpression: true },
        { key: 'limit', value: '20', isExpression: false },
        { key: 'empty_expr', value: 'params.undefined_val', isExpression: true },
      ],
    };
    const routeParams = { category: 'japan' };
    const evaluated = evaluateQueryParamExpressions(queryConfig, routeParams);

    expect(evaluated).toEqual({
      'filter[category][_eq]': 'japan',
      'limit': '20',
      'empty_expr': '',
    });
  });

  it('constructs complete endpoint URL with default search params and resolved query params', () => {
    const apiConfig: ApiCollectionConfig = {
      name: 'Tattoos',
      slug: 'tattoos',
      provider: 'directus',
      url: 'https://cms.example.com/items/tattoos',
      method: 'GET',
      headers: {},
      defaultParams: {
        'fields': '*.*',
      },
      cacheMaxAge: 14400,
    };

    const resolvedParams = {
      'filter[status][_eq]': 'published',
      'limit': '10',
    };

    const fullUrl = resolveApiEndpointWithParams(apiConfig, resolvedParams);
    expect(fullUrl).toContain('https://cms.example.com/items/tattoos');
    expect(fullUrl).toContain('fields=*.');
    expect(fullUrl).toContain('filter%5Bstatus%5D%5B_eq%5D=published');
    expect(fullUrl).toContain('limit=10');
  });
});
