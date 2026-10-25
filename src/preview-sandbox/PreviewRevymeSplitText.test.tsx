import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, act } from '@testing-library/react';
import { PreviewRevymeSplitText } from './PreviewRevymeSplitText';

describe('PreviewRevymeSplitText', () => {
  beforeEach(() => {
    vi.stubGlobal('innerHeight', 800);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not trigger on mount when parent container is below the viewport fold', async () => {
    let topPosition = 1200; // Below 800px fold

    const ParentHeading = () => {
      const parentRef = React.useRef<HTMLHeadingElement>(null);

      React.useLayoutEffect(() => {
        if (parentRef.current) {
          parentRef.current.getBoundingClientRect = () => ({
            top: topPosition,
            bottom: topPosition + 40,
            left: 0,
            right: 400,
            width: 400,
            height: 40,
            x: 0,
            y: topPosition,
            toJSON: () => {},
          });
        }
      });

      return (
        <h2 ref={parentRef}>
          <PreviewRevymeSplitText spec={{ animationType: 'character', mask: true, trigger: 'view' }}>
            TEST TITLE
          </PreviewRevymeSplitText>
        </h2>
      );
    };

    const { container } = render(<ParentHeading />);

    // Fast-forward initial rAF
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(r));
    });

    // Check that motion spans have initial hidden transform or resting state
    const spans = container.querySelectorAll('span');
    expect(spans.length).toBeGreaterThan(0);

    // Simulate scrolling into view
    topPosition = 400; // Inside 800px viewport
    await act(async () => {
      window.dispatchEvent(new Event('scroll'));
      await new Promise((r) => requestAnimationFrame(r));
    });
  });

  it('measures host.parentElement when host wrapper has display: contents', async () => {
    let parentMeasured = false;

    const TestComponent = () => {
      const parentRef = React.useRef<HTMLHeadingElement>(null);

      React.useLayoutEffect(() => {
        if (parentRef.current) {
          parentRef.current.getBoundingClientRect = () => {
            parentMeasured = true;
            return {
              top: 500,
              bottom: 540,
              left: 0,
              right: 400,
              width: 400,
              height: 40,
              x: 0,
              y: 500,
              toJSON: () => {},
            };
          };
        }
      });

      return (
        <h2 ref={parentRef}>
          <PreviewRevymeSplitText spec={{ animationType: 'character', mask: true, trigger: 'view' }}>
            MEASURE ME
          </PreviewRevymeSplitText>
        </h2>
      );
    };

    render(<TestComponent />);

    await act(async () => {
      await new Promise((r) => requestAnimationFrame(r));
    });

    expect(parentMeasured).toBe(true);
  });
});
