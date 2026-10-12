import { describe, it, expect } from 'vitest';
import {
  setCarouselTriggerInCode,
  removeCarouselTriggerInCode,
  getCarouselTriggers,
} from './carousel-trigger-ops';

describe('carousel-trigger-ops', () => {
  const baseCode = `
    export default function Page() {
      return (
        <div>
          <button data-id="btn-1">Prev</button>
          <button data-id="btn-2">Next</button>
          <EmblaCarousel data-id="slider-1" />
        </div>
      );
    }
  `;

  it('sets carousel target and action attributes on target node', () => {
    const updated = setCarouselTriggerInCode(baseCode, 'btn-1', 'slider-1', 'prev');
    expect(updated).toContain('data-carousel-target="slider-1"');
    expect(updated).toContain('data-carousel-action="prev"');

    const conns = getCarouselTriggers(updated, 'slider-1');
    expect(conns.prevIds).toEqual(['btn-1']);
    expect(conns.nextIds).toEqual([]);
  });

  it('replaces existing trigger action if re-assigned', () => {
    const prevWired = setCarouselTriggerInCode(baseCode, 'btn-1', 'slider-1', 'prev');
    const nextWired = setCarouselTriggerInCode(prevWired, 'btn-1', 'slider-1', 'next');
    expect(nextWired).toContain('data-carousel-action="next"');
    expect(nextWired).not.toContain('data-carousel-action="prev"');

    const conns = getCarouselTriggers(nextWired, 'slider-1');
    expect(conns.prevIds).toEqual([]);
    expect(conns.nextIds).toEqual(['btn-1']);
  });

  it('removes carousel trigger attributes from target node', () => {
    const wired = setCarouselTriggerInCode(baseCode, 'btn-1', 'slider-1', 'prev');
    const removed = removeCarouselTriggerInCode(wired, 'btn-1');
    expect(removed).not.toContain('data-carousel-target');
    expect(removed).not.toContain('data-carousel-action');
    expect(getCarouselTriggers(removed, 'slider-1').prevIds).toEqual([]);
  });

  it('handles multiple triggers for prev and next', () => {
    let code = setCarouselTriggerInCode(baseCode, 'btn-1', 'slider-1', 'prev');
    code = setCarouselTriggerInCode(code, 'btn-2', 'slider-1', 'next');
    const conns = getCarouselTriggers(code, 'slider-1');
    expect(conns.prevIds).toEqual(['btn-1']);
    expect(conns.nextIds).toEqual(['btn-2']);
  });

  it('returns code unchanged if targetNodeId is not found', () => {
    const out = setCarouselTriggerInCode(baseCode, 'non-existent', 'slider-1', 'prev');
    expect(out).toBe(baseCode);

    const outRemove = removeCarouselTriggerInCode(baseCode, 'non-existent');
    expect(outRemove).toBe(baseCode);
  });

  it('handles invalid code gracefully', () => {
    const invalidCode = 'const x = {;';
    expect(setCarouselTriggerInCode(invalidCode, 'btn-1', 'slider-1', 'prev')).toBe(invalidCode);
    expect(removeCarouselTriggerInCode(invalidCode, 'btn-1')).toBe(invalidCode);
    expect(getCarouselTriggers(invalidCode, 'slider-1')).toEqual({ prevIds: [], nextIds: [] });
  });

  it('filters triggers by specific carouselId', () => {
    let code = setCarouselTriggerInCode(baseCode, 'btn-1', 'slider-1', 'prev');
    code = setCarouselTriggerInCode(code, 'btn-2', 'slider-2', 'next');

    const slider1Conns = getCarouselTriggers(code, 'slider-1');
    expect(slider1Conns.prevIds).toEqual(['btn-1']);
    expect(slider1Conns.nextIds).toEqual([]);

    const slider2Conns = getCarouselTriggers(code, 'slider-2');
    expect(slider2Conns.prevIds).toEqual([]);
    expect(slider2Conns.nextIds).toEqual(['btn-2']);
  });

  it('preserves other attributes on target node when setting and removing', () => {
    const codeWithAttrs = `
      export default function Page() {
        return (
          <button data-id="btn-1" className="btn-class" onClick={() => {}}>Prev</button>
        );
      }
    `;
    const wired = setCarouselTriggerInCode(codeWithAttrs, 'btn-1', 'slider-1', 'prev');
    expect(wired).toContain('className="btn-class"');
    expect(wired).toContain('data-carousel-target="slider-1"');
    expect(wired).toContain('data-carousel-action="prev"');

    const unwired = removeCarouselTriggerInCode(wired, 'btn-1');
    expect(unwired).toContain('className="btn-class"');
    expect(unwired).not.toContain('data-carousel-target');
    expect(unwired).not.toContain('data-carousel-action');
  });

  it('replaces previous node wired to the same action to prevent duplicate triggers', () => {
    let code = setCarouselTriggerInCode(baseCode, 'btn-1', 'slider-1', 'prev');
    expect(getCarouselTriggers(code, 'slider-1').prevIds).toEqual(['btn-1']);

    // Now wire btn-2 to prev for the same slider
    code = setCarouselTriggerInCode(code, 'btn-2', 'slider-1', 'prev');
    const conns = getCarouselTriggers(code, 'slider-1');
    expect(conns.prevIds).toEqual(['btn-2']);
    expect(code).not.toContain('data-id="btn-1" data-carousel-target="slider-1"');
  });
});
