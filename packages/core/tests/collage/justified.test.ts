import { describe, expect, it } from 'vitest';
import {
  justifiedCols,
  justifiedRows,
  type InnerRegion,
} from '../../src/collage/index.js';

const region = (
  overrides: Partial<InnerRegion> = {},
): InnerRegion => ({
  x: 0,
  y: 0,
  w: 800,
  h: 1200,
  gap: 0,
  ...overrides,
});

describe('justifiedRows', () => {
  it('empty input returns empty array', () => {
    expect(justifiedRows([], region())).toEqual([]);
  });

  it('preserves aspect ratios of every placed rect', () => {
    const aspects = [1, 1.5, 0.75, 2, 0.5];
    const out = justifiedRows(aspects, region({ gap: 0 }));
    expect(out).toHaveLength(aspects.length);
    for (let i = 0; i < aspects.length; i++) {
      const r = out[i];
      expect(r.w / r.h).toBeCloseTo(aspects[i], 6);
    }
  });

  it('stays within the region bounds after uniform scale-to-fit', () => {
    const aspects = [1, 1.5, 0.75, 2, 0.5, 1.2];
    const r = region({ w: 600, h: 400, gap: 12 });
    const out = justifiedRows(aspects, r);
    for (const rect of out) {
      expect(rect.x).toBeGreaterThanOrEqual(r.x - 1e-6);
      expect(rect.y).toBeGreaterThanOrEqual(r.y - 1e-6);
      expect(rect.x + rect.w).toBeLessThanOrEqual(r.x + r.w + 1e-6);
      expect(rect.y + rect.h).toBeLessThanOrEqual(r.y + r.h + 1e-6);
    }
  });

  it('for a single row (all similar aspects, wide region) all rects share the same y and height', () => {
    // Very wide region + 3 equal aspects: linear-partition picks k=1.
    const aspects = [1, 1, 1];
    const out = justifiedRows(aspects, region({ w: 3000, h: 400, gap: 0 }));
    const [a, b, c] = out;
    expect(b.y).toBeCloseTo(a.y, 6);
    expect(c.y).toBeCloseTo(a.y, 6);
    expect(b.h).toBeCloseTo(a.h, 6);
    expect(c.h).toBeCloseTo(a.h, 6);
    // rects are placed left-to-right, touching (gap=0).
    expect(b.x).toBeCloseTo(a.x + a.w, 6);
    expect(c.x).toBeCloseTo(b.x + b.w, 6);
  });

  it('with a very tall region + many photos, the algorithm breaks into multiple rows', () => {
    const aspects = Array.from({ length: 8 }, () => 1);
    const out = justifiedRows(aspects, region({ w: 400, h: 4000, gap: 0 }));
    // At least one photo should be on a lower y than the first.
    const ys = out.map((r) => r.y);
    const uniqueYs = new Set(ys.map((y) => y.toFixed(3)));
    expect(uniqueYs.size).toBeGreaterThan(1);
  });
});

describe('justifiedCols (transpose)', () => {
  it('is the axis-swapped transpose of justifiedRows', () => {
    const aspects = [1, 1.5, 0.75, 2, 0.5];
    // Region is symmetric-ish, but the important part is that swapping w<->h
    // + inverting aspects yields the same set of rects with axes swapped.
    const rowsOut = justifiedRows(
      aspects.map((a) => 1 / a),
      region({ w: 400, h: 800, gap: 4 }),
    );
    const colsOut = justifiedCols(
      aspects,
      region({ w: 800, h: 400, gap: 4 }),
    );
    // Every cols rect has (x=y_row, y=x_row, w=h_row, h=w_row)
    expect(colsOut).toHaveLength(rowsOut.length);
    for (let i = 0; i < rowsOut.length; i++) {
      const r = rowsOut[i];
      const c = colsOut[i];
      expect(c.x).toBeCloseTo(r.y, 6);
      expect(c.y).toBeCloseTo(r.x, 6);
      expect(c.w).toBeCloseTo(r.h, 6);
      expect(c.h).toBeCloseTo(r.w, 6);
    }
  });

  it('preserves input aspect ratios (not inverted)', () => {
    const aspects = [1, 1.5, 0.75, 2];
    const out = justifiedCols(aspects, region({ w: 800, h: 400, gap: 0 }));
    for (let i = 0; i < aspects.length; i++) {
      const r = out[i];
      expect(r.w / r.h).toBeCloseTo(aspects[i], 6);
    }
  });
});
