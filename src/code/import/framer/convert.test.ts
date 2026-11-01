import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import { convertFramerPayload } from './convert';

describe('convertFramerPayload', () => {
  it('converts basic FrameNode to ClipboardData', () => {
    const raw = {
      layers: {
        tree: {
          root: {
            children: [
              {
                __class: 'FrameNode',
                id: 'frame-1',
                name: 'Hero',
                layout: 'stack',
                stackDirection: 'vertical',
                stackAlignment: 'center',
                stackDistribution: 'space-between',
                width: 1200,
                height: 800,
                fillColor: '#121212',
                children: [
                  {
                    __class: 'RichTextNode',
                    id: 'text-1',
                    html: '<h1 class="framer">Hello World</h1>',
                  }
                ]
              }
            ]
          }
        }
      }
    };

    const res = convertFramerPayload(raw);
    const rootNodes = res.nodes.filter(n => n.parentId === null);
    expect(rootNodes.map(n => n.id)).toEqual(['frame-1']);
    expect(res.nodes).toHaveLength(2);

    const frame = res.nodes.find(n => n.id === 'frame-1');
    expect(frame).toBeDefined();
    expect(frame?.type).toBe('div');
    expect(frame?.styles.display).toBe('flex');
    expect(frame?.styles.flexDirection).toBe('column');
    expect(frame?.styles.alignItems).toBe('center');
    expect(frame?.styles.justifyContent).toBe('space-between');
    expect(frame?.styles.backgroundColor).toBe('#121212');

    const text = res.nodes.find(n => n.id === 'text-1');
    expect(text).toBeDefined();
    expect(text?.type).toBe('h1');
    expect(text?.textContent).toBe('Hello World');
  });

  it('converts full project export Walker file', () => {
    const filePath = '/home/rost/Завантажене/Walker__copy_-full-site.json';
    if (!fs.existsSync(filePath)) return;

    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const res = convertFramerPayload(raw);

    const rootNodes = res.nodes.filter(n => n.parentId === null);
    expect(rootNodes.length).toBeGreaterThan(0);
    expect(res.nodes.length).toBe(21);

    const rootNode = rootNodes[0];
    expect(rootNode).toBeDefined();
    expect(rootNode?.type).toBe('div');
    expect(rootNode?.children.length).toBeGreaterThan(0);
  });
});
