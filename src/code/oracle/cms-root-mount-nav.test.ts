// cms-root-mount-nav.test.ts — slug navigation for a collection that owns
// the site ROOT.
//
// `/blog/my-post` carries its collection in the URL; a root-mounted
// collection's items are just `/amara-okeke`. So every nav link on such a
// page drops the segment, and the ORACLE has to expect the same thing — it
// recomputes the canonical href by calling the generator itself, which is the
// mechanism that keeps the two from drifting. This file is the proof that the
// mechanism survives the root case.

import { describe, it, expect, vi } from 'vitest';

vi.mock('@/shared/debug-trace', () => ({ trace: { action: vi.fn(), fn: vi.fn(), error: vi.fn() } }));

// The project has `team` at the root. Mocked rather than assembled on a fake
// FS because what is under test is the AGREEMENT between generator and
// oracle, not the filesystem scan (that is cms-page-ops.test.ts).
vi.mock('@/code/project/cms-root-mount', () => ({
  isRootMounted: (c: string) => c === 'team',
  rootMountedCollection: () => 'team',
  isRootSlugPage: (p: string) => /^app\/\[[^/\]]+\]\/page\.client\.tsx$/.test(p),
  rootSlugPageFile: () => 'app/[slug]/page.client.tsx',
  rootMountBlockedBy: (c: string) => (c === 'team' ? null : 'team'),
}));

import { checkFile } from './check-file';
import { cmsNavHrefExpr } from '@/code/generation/map-gen';

const DETAIL = (collection: string, body: string) => `'use client';

/** @canvas { "viewports": [{ "id": "desktop", "label": "Desktop", "width": 1440, "isPrimary": true, "order": 0 }], "positions": { "desktop": { "x": 0, "y": 0 } } } */

/** @cmsPage { "collection": "${collection}", "kind": "detail" } */

import React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import ${collection} from '@/cms/${collection}.json';

export default function Page() {
  const params = useParams();
  const item = ${collection}.find((i) => i._slug === params?.slug) ?? ${collection}[0];
  return (
    <div data-id="root" data-name="Page" style={{ position: 'relative', width: '100%', height: '900px' }}>
${body}
    </div>
  );
}`;

const nav = (code: string) => checkFile(code, { kind: 'page' }).filter((x) => x.code.startsWith('CMS_NAV_'));

describe('a collection mounted at the root', () => {
  it('links without a collection segment', () => {
    expect(cmsNavHrefExpr('team', 'team', 'self')).toBe("`/${params?.slug ?? ''}`");
    expect(cmsNavHrefExpr('team', 'team', 'row')).toBe("`/${item?._slug ?? ''}`");
    expect(cmsNavHrefExpr('team', 'team', 'next'))
      .toBe("`/${team[team.findIndex((i) => i._slug === params?.slug) + 1]?._slug ?? ''}`");
  });

  it('leaves a nested collection exactly where it was', () => {
    expect(cmsNavHrefExpr('blog', 'blog', 'self')).toBe("`/blog/${params?.slug ?? ''}`");
    expect(cmsNavHrefExpr('blog', 'blog', 'row')).toBe("`/blog/${item?._slug ?? ''}`");
  });

  it('the oracle accepts the root form it generates', () => {
    for (const mode of ['self', 'prev', 'next'] as const) {
      const href = `href={${cmsNavHrefExpr('team', 'team', mode)}}`;
      const code = DETAIL('team',
        `      <Link data-id="${mode}" data-name="a" data-cms-nav="${mode}" ${href} style={{ position: 'relative' }}>Go</Link>`);
      expect(nav(code), mode).toEqual([]);
    }
  });

  // The old nested form is now WRONG for this collection: it would send every
  // reader to `/team/amara-okeke`, which the site does not serve.
  it('the oracle rejects the nested form on a root collection', () => {
    const stale = "href={`/team/${params?.slug ?? ''}`}";
    const code = DETAIL('team',
      `      <Link data-id="self" data-name="a" data-cms-nav="self" ${stale} style={{ position: 'relative' }}>Go</Link>`);
    expect(nav(code).map((x) => x.code)).toContain('CMS_NAV_HREF_MISMATCH');
  });

  it('still rejects the root form on a NESTED collection', () => {
    const wrong = "href={`/${params?.slug ?? ''}`}";
    const code = DETAIL('blog',
      `      <Link data-id="self" data-name="a" data-cms-nav="self" ${wrong} style={{ position: 'relative' }}>Go</Link>`);
    expect(nav(code).map((x) => x.code)).toContain('CMS_NAV_HREF_MISMATCH');
  });
});
