import { describe, expect, it } from 'vitest';
import { findContentSlot } from './slot-children';

describe('findContentSlot', () => {
  it('finds the layout children slot between template components', () => {
    const code = `
      import SiteNavbar from '@/components/SiteNavbar';
      import SiteFooter from '@/components/SiteFooter';
      export default function LayoutClient({ children }) {
        return <div data-id="root">
          <SiteNavbar data-id="navbar" />
          {children}
          <SiteFooter data-id="footer" />
        </div>;
      }
    `;

    expect(findContentSlot(code)).toMatchObject({
      parentDataId: 'root',
      siblingIndex: 1,
      isWrappedInPageTransitions: false,
    });
  });
});
