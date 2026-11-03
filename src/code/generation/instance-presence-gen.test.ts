import { expect, it } from 'vitest';
import { wrapInstanceForPresence } from './instance-presence-gen';
import { parseJSXToNodes } from '../parsing/parser';

it('keeps placement on an editable presence frame and preserves the nested design instance', () => {
  const source = `import Card from '@/components/Card'; export default function Page(){return <div data-id="root"><Card data-id="card" data-component="components/Card.tsx" initialVariant="mobile" onClick={openMenu} style={{position:'fixed',width:'100%',height:'72px',top:'0px',order:'2'}} /></div>;}`;
  const result = wrapInstanceForPresence(source, 'card');
  const nodes = parseJSXToNodes(result.code);
  expect(nodes.get('card')?.styles).toMatchObject({ position: 'fixed', width: '100%', height: '72px', top: '0px', order: '2' });
  expect(nodes.get(result.contentId)?.parentId).toBe('card');
  expect(nodes.get(result.contentId)?.styles).toMatchObject({ position: 'relative', width: '100%', height: '100%' });
  expect(nodes.get(result.contentId)?.attrs.initialVariant).toBe('mobile');
  expect(result.code).toContain('onClick={openMenu}');
});
