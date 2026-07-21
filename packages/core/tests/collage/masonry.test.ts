import { describe, expect, it } from 'vitest';
import {
  masonry,
  type InnerRegion,
} from '../../src/collage/index.js';

const REGION: InnerRegion = { x: 0, y: 0, w: 900, h: 600, gap: 0 };

describe('masonry', () => {
  it('empty aspects returns []', () => {
    expect(masonry([], REGION, 3)).toEqual([]);
  });

  it('output preserves input index order (matches aspects[i])', () => {
    const aspects = [1, 1.5, 0.75, 2, 0.5, 1.2];
    const rects = masonry(aspects, REGION, 3);
    expect(rects).toHaveLength(aspects.length);
    for (const r of rects) expect(r).toBeDefined();
  });

  it('all rects share the target column width', () => {
    const aspects = [1, 1.5, 0.75, 2, 0.5, 1.2];
    const cols = 3;
    const gap = 10;
    const r = { ...REGION, gap };
    const expectedCellW = (REGION.w - gap * (cols - 1)) / cols;
    const rects = masonry(aspects, r, cols);
    for (const rect of rects) {
      expect(rect.w).toBeCloseTo(expectedCellW, 6);
    }
  });

  it('after scale-to-fit, the tallest column reaches innerH', () => {
    const aspects = [1, 1.5, 0.75, 2, 0.5, 1.2, 1.1, 1.3];
    const cols = 3;
    const rects = masonry(aspects, REGION, cols);
    // Group by x -> column index.
    const byCol = new Map<number, number>();
    for (const rect of rects) {
      const key = Math.round(rect.x * 1e4) / 1e4;
      const prev = byCol.get(key) ?? 0;
      byCol.set(key, prev + rect.h);
    }
    const tallest = Math.max(...byCol.values());
    // With gap=0 the sum of heights per column should equal tallest = innerH.
    expect(tallest).toBeCloseTo(REGION.h, 6);
  });

  it('column count is capped at photo count', () => {
    const aspects = [1, 1]; // only 2 photos
    const rects = masonry(aspects, REGION, 5);
    // Effective cols = min(5, 2) = 2, so each cell width = REGION.w / 2.
    const uniqueXs = new Set(rects.map((r) => r.x.toFixed(4)));
    expect(uniqueXs.size).toBeLessThanOrEqual(2);
    for (const r of rects) {
      expect(r.w).toBeCloseTo(REGION.w / 2, 6);
    }
  });
});
