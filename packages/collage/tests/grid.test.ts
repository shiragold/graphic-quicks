import { describe, expect, it } from 'vitest';
import { grid, type InnerRegion } from '../src/index.js';

const REGION: InnerRegion = { x: 0, y: 0, w: 900, h: 600, gap: 0 };

describe('grid', () => {
  it('empty aspects returns []', () => {
    expect(grid([], REGION, 3)).toEqual([]);
  });

  it('uses equal cells on shared column tracks', () => {
    const aspects = [1, 1.5, 0.75, 2, 0.5, 1.2];
    const cols = 3;
    const rects = grid(aspects, REGION, cols);
    const cellW = REGION.w / cols;
    const cellH = REGION.h / 2;

    expect(rects).toHaveLength(aspects.length);
    for (const rect of rects) {
      expect(rect.w).toBeCloseTo(cellW, 6);
      expect(rect.h).toBeCloseTo(cellH, 6);
    }
    for (let col = 0; col < cols; col++) {
      expect(rects[col].x).toBeCloseTo(rects[col + cols].x, 6);
      expect(rects[col].y).toBeCloseTo(0, 6);
      expect(rects[col + cols].y).toBeCloseTo(cellH, 6);
    }
  });

  it('keeps a short last row on the same column width', () => {
    const aspects = [1, 1, 1, 1, 1];
    const cols = 3;
    const gap = 12;
    const region: InnerRegion = { ...REGION, gap };
    const rects = grid(aspects, region, cols);
    const cellW = (REGION.w - gap * (cols - 1)) / cols;
    const cellH = (REGION.h - gap) / 2;

    expect(rects[3].w).toBeCloseTo(cellW, 6);
    expect(rects[3].h).toBeCloseTo(cellH, 6);
    expect(rects[4].w).toBeCloseTo(cellW, 6);
    expect(rects[3].x).toBeCloseTo(rects[0].x, 6);
    expect(rects[4].x).toBeCloseTo(rects[1].x, 6);
    expect(rects[3].y).toBeCloseTo(cellH + gap, 6);
    expect(rects[4].x + rects[4].w).toBeLessThan(REGION.w - cellW / 2);
  });

  it('caps columns at the photo count', () => {
    const rects = grid([1, 1, 1], REGION, 10);
    expect(rects).toHaveLength(3);
    for (const rect of rects) {
      expect(rect.w).toBeCloseTo(REGION.w / 3, 6);
      expect(rect.h).toBeCloseTo(REGION.h, 6);
      expect(rect.y).toBeCloseTo(0, 6);
    }
  });
});
