// e2e/automation-v2/L02-dynamic.spec.ts
/**
 * E2E Acceptance Spec L02: Dynamic Content, CMS, Search, Locales & Page Variables
 */

import { describe, it, expect } from 'vitest';
import {
  createSnapshot,
  createOperationContext,
  cmsSchemaCreateOperation,
  cmsFieldAddOperation,
  cmsItemsCreateOperation,
  cmsApiModeSetOperation,
  localesAddOperation,
  variablesCreateOperation,
} from '@revyme/automation-core';

describe('E2E L02: Dynamic Content & CMS Spec', () => {
  const context = createOperationContext();

  it('validates CMS collections, external API mode, i18n locales, and variables', async () => {
    let snapshot = createSnapshot(
      { projectId: 'e2e-project', branchId: 'main' },
      0,
      {
        'app/page.tsx': `'use client';
export default function Page() {
  return <div data-id="root">Page</div>;
}
`,
      },
    );

    // 1. Create collection and add fields
    const collRes = await cmsSchemaCreateOperation.execute(
      snapshot,
      {
        name: 'Products',
        slug: 'products',
        fields: [{ id: 'title', name: 'Title', type: 'text', required: true }],
      },
      context,
    );
    expect(collRes.slug).toBe('products');

    const fldRes = await cmsFieldAddOperation.execute(
      snapshot,
      { collection: 'products', name: 'Price', type: 'number' },
      context,
    );
    expect(fldRes.fieldId).toBeDefined();

    // 2. Add CMS Item
    const itemRes = await cmsItemsCreateOperation.execute(
      snapshot,
      { collection: 'products', item: { _slug: 'pro-tier', price: 99 } },
      context,
    );
    expect(itemRes.item._slug).toBe('pro-tier');

    // 3. API Mode
    const apiModeRes = await cmsApiModeSetOperation.execute(
      snapshot,
      { mode: 'api' },
      context,
    );
    expect(apiModeRes.mode).toBe('api');

    // 4. Locales
    const localeRes = await localesAddOperation.execute(
      snapshot,
      { code: 'de', label: 'German', direction: 'ltr' },
      context,
    );
    expect(localeRes.code).toBe('de');

    // 5. Variables
    const varRes = await variablesCreateOperation.execute(
      snapshot,
      { targetFile: 'app/page.tsx', name: 'discountPercent', type: 'text', defaultValue: '15' },
      context,
    );
    expect(varRes.variable.name).toBe('discountPercent');
  });
});
