import { describe, expect, it } from 'vitest';
import {
  heroGrid,
  type InnerRegion,
} from '../../src/collage/index.js';

const LANDSCAPE: InnerRegion = { x: 0, y: 0, w: 1200, h: 800, gap: 0 };
const PORTRAIT: InnerRegion = { x: 0, y: 0, w: 800, h: 1200, gap: 0 };

describe('heroGrid', () => {
  it('n=0 returns []', () => {
    expect(heroGrid([], LANDSCAPE, 'center')).toEqual([]);
  });

  it('n=1 fills the region as the hero', () => {
    const rects = heroGrid([1.5], LANDSCAPE, 'center');
    expect(rects).toHaveLength(1);
    const r = rects[0];
    expect(r.x).toBeCloseTo(LANDSCAPE.x, 6);
    expect(r.y).toBeCloseTo(LANDSCAPE.y, 6);
    expect(r.w).toBeCloseTo(LANDSCAPE.w, 6);
    expect(r.h).toBeCloseTo(LANDSCAPE.h, 6);
  });

  it('landscape start: hero is at region.x, full height, 50% width', () => {
    const aspects = [1, 1, 1, 1];
    const rects = heroGrid(aspects, LANDSCAPE, 'start');
    const hero = rects[0];
    expect(hero.x).toBeCloseTo(LANDSCAPE.x, 6);
    expect(hero.y).toBeCloseTo(LANDSCAPE.y, 6);
    expect(hero.w).toBeCloseTo(LANDSCAPE.w * 0.5, 6);
    expect(hero.h).toBeCloseTo(LANDSCAPE.h, 6);
  });

  it('landscape end: hero occupies the right half', () => {
    const aspects = [1, 1, 1, 1];
    const rects = heroGrid(aspects, LANDSCAPE, 'end');
    const hero = rects[0];
    expect(hero.w).toBeCloseTo(LANDSCAPE.w * 0.5, 6);
    expect(hero.h).toBeCloseTo(LANDSCAPE.h, 6);
    expect(hero.x + hero.w).toBeCloseTo(LANDSCAPE.x + LANDSCAPE.w, 6);
  });

  it('landscape center: hero is in the horizontal middle', () => {
    const aspects = [1, 1, 1, 1, 1];
    const rects = heroGrid(aspects, LANDSCAPE, 'center');
    const hero = rects[0];
    expect(hero.w).toBeCloseTo(LANDSCAPE.w * 0.5, 6);
    // Hero should sit roughly in the middle: side pads on both sides.
    const heroCenterX = hero.x + hero.w / 2;
    expect(heroCenterX).toBeCloseTo(LANDSCAPE.x + LANDSCAPE.w / 2, 6);
  });

  it('portrait start: hero is at region.y, full width, 50% height', () => {
    const aspects = [1, 1, 1, 1];
    const rects = heroGrid(aspects, PORTRAIT, 'start');
    const hero = rects[0];
    expect(hero.x).toBeCloseTo(PORTRAIT.x, 6);
    expect(hero.y).toBeCloseTo(PORTRAIT.y, 6);
    expect(hero.w).toBeCloseTo(PORTRAIT.w, 6);
    expect(hero.h).toBeCloseTo(PORTRAIT.h * 0.5, 6);
  });

  it('index 0 is always the hero (biggest area)', () => {
    const aspects = [1, 1, 1, 1, 1];
    for (const pos of ['start', 'center', 'end'] as const) {
      for (const region of [LANDSCAPE, PORTRAIT]) {
        const rects = heroGrid(aspects, region, pos);
        const heroArea = rects[0].w * rects[0].h;
        for (let i = 1; i < rects.length; i++) {
          const a = rects[i].w * rects[i].h;
          expect(heroArea).toBeGreaterThanOrEqual(a - 1e-6);
        }
      }
    }
  });
});
