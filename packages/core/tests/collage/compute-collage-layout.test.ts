import { describe, expect, it } from 'vitest';
import {
  computeCollageLayout,
  type CollagePlacement,
  type CollageSettings,
  type LayoutKind,
  type PolaroidPlacement,
  type Rect,
} from '../../src/collage/index.js';

const isPolaroid = (p: CollagePlacement): p is PolaroidPlacement =>
  'polaroid' in p;
const isRect = (p: CollagePlacement): p is Rect => !isPolaroid(p);
const isDefinedRect = (p: CollagePlacement | undefined): p is Rect =>
  p !== undefined && isRect(p);

const aspects = [1, 1.5, 0.75, 2, 0.5];

const base: Omit<CollageSettings, 'layout'> = {
  width: 800,
  height: 1200,
  gap: 8,
  padding: 0,
  columns: 2,
  heroPos: 'center',
};

describe('computeCollageLayout', () => {
  const layouts: LayoutKind[] = [
    'justified-rows',
    'justified-cols',
    'grid',
    'columns',
    'hero-grid',
    'polaroid',
    'row',
    'column',
  ];

  for (const layout of layouts) {
    it(`${layout}: returns a placement for each aspect`, () => {
      const out = computeCollageLayout(aspects, { ...base, layout });
      expect(out).toHaveLength(aspects.length);
      for (const p of out) {
        expect(p).toBeDefined();
      }
    });
  }

  it('mosaic (n<=9): returns a rect for each aspect', () => {
    const out = computeCollageLayout(aspects, { ...base, layout: 'mosaic' });
    expect(out).toHaveLength(aspects.length);
    for (const p of out) {
      expect(p).toBeDefined();
      if (p) {
        expect(isRect(p)).toBe(true);
      }
    }
  });

  it('mosaic (n>9): returns an empty array', () => {
    const many = new Array<number>(10).fill(1);
    const out = computeCollageLayout(many, { ...base, layout: 'mosaic' });
    expect(out).toEqual([]);
  });

  it('n=0: returns an empty array for every layout', () => {
    for (const layout of [...layouts, 'mosaic' as const]) {
      const out = computeCollageLayout([], { ...base, layout });
      expect(out).toEqual([]);
    }
  });

  it('polaroid returns PolaroidPlacement objects', () => {
    const out = computeCollageLayout(aspects, { ...base, layout: 'polaroid' });
    for (const p of out) {
      expect(p).toBeDefined();
      if (p) expect(isPolaroid(p)).toBe(true);
    }
  });

  it('padding is applied around every layout region', () => {
    const padding = 40;
    const settings: CollageSettings = {
      ...base,
      layout: 'row',
      padding,
      gap: 0,
    };
    const out = computeCollageLayout([1, 1, 1], settings);
    const rects = out.filter(isDefinedRect);
    expect(rects).toHaveLength(3);
    expect(rects[0].x).toBeCloseTo(padding, 6);
    expect(rects[0].y).toBeCloseTo(padding, 6);
    const last = rects[rects.length - 1];
    expect(last.x + last.w).toBeCloseTo(settings.width - padding, 6);
  });
});
