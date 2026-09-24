// cms-root-mount.ts — which collection, if any, owns the site's root `[slug]`.
//
// A collection's detail page usually sits under the collection's own name:
// `app/blog/[slug]/page.client.tsx` serves `/blog/my-post`. A collection can
// instead own the ROOT: `app/[slug]/page.client.tsx` serves `/my-post`, with
// nothing in front of it. Plenty of real sites are built that way — a team
// directory at `/amara-okeke`, a portfolio at `/some-project` — and an import
// that cannot express it has to flatten the collection into one hand-written
// page per item.
//
// Only ONE collection can own it. Two would make `/amara-okeke` ambiguous:
// nothing in the URL says which collection to resolve the slug against.
// Nested collections have no such limit, because their prefix disambiguates.
//
// Ownership is DERIVED, never recorded. A manifest would need releasing on
// delete, undo, branch switch and file move; reading it back off the files
// means those all stay consistent for free, and the answer cannot go stale.
//
// Static routes still win: `app/about-us/page.client.tsx` serves `/about-us`
// even with a root `[slug]` present, because a literal segment beats a
// dynamic one — the same precedence the published site relies on.

import { projectFS } from './project-fs';
import { parseCmsPageMeta } from './cms-page-meta';

/** A page file that serves the root `[slug]`, route group or not. */
const ROOT_SLUG_PAGE = /^app\/(?:\([^)]+\)\/)?\[[^/\]]+\]\/page\.client\.tsx$/;

/** True for the one path shape this module is about. */
export function isRootSlugPage(filePath: string): boolean {
  return ROOT_SLUG_PAGE.test(filePath);
}

/** The file serving the root `[slug]`, or null when nothing does. */
export function rootSlugPageFile(): string | null {
  return projectFS.listFiles('app/').find(isRootSlugPage) ?? null;
}

/**
 * The collection mounted at the root, or null when the root is free.
 *
 * An empty `[slug]` directory left behind by a delete is not an owner — the
 * annotation on a real page is what counts.
 */
export function rootMountedCollection(): string | null {
  const file = rootSlugPageFile();
  if (!file) return null;
  const code = projectFS.readFile(file);
  if (!code) return null;
  const meta = parseCmsPageMeta(code);
  return meta?.kind === 'detail' ? meta.collection : null;
}

/** Whether THIS collection's detail page is the one at the root. */
export function isRootMounted(collection: string): boolean {
  return !!collection && rootMountedCollection() === collection;
}

/**
 * Why `collection` may not take the root, or null when it may.
 *
 * The message is the refusal the user reads, so it names the collection in
 * the way: "already taken" with no culprit is the kind of error people
 * re-trigger three times before giving up.
 */
export function rootMountBlockedBy(collection: string): string | null {
  const owner = rootMountedCollection();
  if (!owner || owner === collection) return null;
  return owner;
}
