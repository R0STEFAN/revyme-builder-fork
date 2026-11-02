import { expect, it } from 'vitest';
import { parsePropMeta } from '../components/prop-meta';
import { initMutationQueue, queueMutation, flushNow, getCurrentCode } from './mutation-queue';

it('preserves the reference collection through native rename and metadata edits', () => {
  const code = `'use client';
    /** @propMeta {"category":{"type":"reference","referenceCollection":"categories","label":"Category"}} */
    export default function Card({ category = 'record-a' }) { return <div data-id="root">{category}</div>; }`;
  initMutationQueue(code, () => {}, () => {}, () => {});
  queueMutation({ type: 'renameComponentVariable', oldName: 'category', newName: 'topic' });
  flushNow();
  expect(parsePropMeta(getCurrentCode()).topic).toMatchObject({ type: 'reference', referenceCollection: 'categories', label: 'Category' });
  expect(parsePropMeta(getCurrentCode()).category).toBeUndefined();
  queueMutation({ type: 'setComponentPropReferenceCollection', propName: 'topic', collection: 'topics' });
  flushNow();
  expect(parsePropMeta(getCurrentCode()).topic.referenceCollection).toBe('topics');
});
