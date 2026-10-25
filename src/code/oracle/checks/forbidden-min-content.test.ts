import { describe, it, expect } from 'vitest';
import { checkFile } from '../check-file';

describe('FORBIDDEN_MIN_CONTENT_HEIGHT oracle rule', () => {
  const codes = (src: string, kind: 'page' | 'component' = 'page') =>
    checkFile(src, { kind }).map((v) => v.code);

  it('bounces height: min-content in @media rule targeting a component instance', () => {
    const code = `
import React from 'react';
import GalleryDeck from '@/components/GalleryDeck';

export default function Page() {
  return (
    <div data-id="root" style={{ position: 'relative', width: '100%', height: 'auto' }}>
      <style>{\`
        @media (max-width: 810px) {
          [data-id="chronicle-gallery-deck"] { flex: 0 0 auto !important; height: min-content !important; }
        }
      \`}</style>
      <section data-id="section-chronicle" style={{ position: 'relative', width: '100%', height: 'auto', order: '0' }}>
        <GalleryDeck data-id="chronicle-gallery-deck" style={{ position: 'relative', width: '100%', height: 'auto', order: '0' }} />
      </section>
    </div>
  );
}
`;
    const c = codes(code, 'page');
    expect(c).toContain('FORBIDDEN_MIN_CONTENT_HEIGHT');
  });

  it('bounces height: min-content in @media rule targeting a section', () => {
    const code = `
import React from 'react';

export default function Page() {
  return (
    <div data-id="root" style={{ position: 'relative', width: '100%', height: 'auto' }}>
      <style>{\`
        @media (max-width: 810px) {
          [data-id="section-hero"] { height: min-content !important; }
        }
      \`}</style>
      <section data-id="section-hero" style={{ position: 'relative', width: '100%', height: 'auto', order: '0' }}>
        <h1 data-id="hero-title" style={{ position: 'relative', order: '0' }}>Hero</h1>
      </section>
    </div>
  );
}
`;
    const c = codes(code, 'page');
    expect(c).toContain('FORBIDDEN_MIN_CONTENT_HEIGHT');
  });

  it('bounces inline height: min-content on a component instance', () => {
    const code = `
import React from 'react';
import GalleryDeck from '@/components/GalleryDeck';

export default function Page() {
  return (
    <div data-id="root" style={{ position: 'relative', width: '100%', height: 'auto' }}>
      <section data-id="section-chronicle" style={{ position: 'relative', width: '100%', height: 'auto', order: '0' }}>
        <GalleryDeck data-id="chronicle-gallery-deck" style={{ position: 'relative', width: '100%', height: 'min-content', order: '0' }} />
      </section>
    </div>
  );
}
`;
    const c = codes(code, 'page');
    expect(c).toContain('FORBIDDEN_MIN_CONTENT_HEIGHT');
  });

  it('allows height: auto and explicit px heights on component instances and in media rules', () => {
    const code = `
import React from 'react';
import GalleryDeck from '@/components/GalleryDeck';

export default function Page() {
  return (
    <div data-id="root" style={{ position: 'relative', width: '100%', height: 'auto' }}>
      <style>{\`
        @media (max-width: 810px) {
          [data-id="chronicle-gallery-deck"] { flex: 0 0 auto !important; height: auto !important; }
        }
      \`}</style>
      <section data-id="section-chronicle" style={{ position: 'relative', width: '100%', height: 'auto', order: '0' }}>
        <GalleryDeck data-id="chronicle-gallery-deck" style={{ position: 'relative', width: '100%', height: 'auto', order: '0' }} />
      </section>
    </div>
  );
}
`;
    const c = codes(code, 'page');
    expect(c).not.toContain('FORBIDDEN_MIN_CONTENT_HEIGHT');
  });
});
