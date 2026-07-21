import { describe, expect, it } from 'vitest';
import {
  mosaic,
  type InnerRegion,
  type Rect,
} from '../../src/collage/index.js';

const REGION: InnerRegion = { x: 0, y: 0, w: 1000, h: 800, gap: 0 };
const REGION_PORTRAIT: InnerRegion = { x: 0, y: 0, w: 800, h: 1000, gap: 0 };

function overlaps(a: Rect, b: Rect, eps = 1e-6): boolean {
  return (
    a.x + a.w > b.x + eps &&
    b.x + b.w > a.x + eps &&
    a.y + a.h > b.y + eps &&
    b.y + b.h > a.y + eps
  );
}

function fitsIn(r: Rect, region: InnerRegion, eps = 1e-6): boolean {
  return (
    r.x >= region.x - eps &&
    r.y >= region.y - eps &&
    r.x + r.w <= region.x + region.w + eps &&
    r.y + r.h <= region.y + region.h + eps
  );
}

describe('mosaic', () => {
  it('returns [] for n=0', () => {
    expect(mosaic([], REGION)).toEqual([]);
  });

  it('returns [] for n>9', () => {
    const aspects = new Array<number>(10).fill(1);
    expect(mosaic(aspects, REGION)).toEqual([]);
  });

  for (let n = 1; n <= 9; n++) {
    it(`n=${n} (landscape): every rect has positive w/h, no overlaps, fits region`, () => {
      const aspects = Array.from({ length: n }, (_, i) => 1 + i * 0.1);
      const rects = mosaic(aspects, REGION);
      expect(rects).toHaveLength(n);
      for (const r of rects) {
        expect(r).toBeDefined();
        expect(r.w).toBeGreaterThan(0);
        expect(r.h).toBeGreaterThan(0);
        expect(fitsIn(r, REGION)).toBe(true);
      }
      for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
          expect(overlaps(rects[i], rects[j])).toBe(false);
        }
      }
    });

    it(`n=${n} (portrait): every rect has positive w/h, no overlaps, fits region`, () => {
      const aspects = Array.from({ length: n }, (_, i) => 0.8 - i * 0.05);
      const rects = mosaic(aspects, REGION_PORTRAIT);
      expect(rects).toHaveLength(n);
      for (const r of rects) {
        expect(r).toBeDefined();
        expect(r.w).toBeGreaterThan(0);
        expect(r.h).toBeGreaterThan(0);
        expect(fitsIn(r, REGION_PORTRAIT)).toBe(true);
      }
      for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
          expect(overlaps(rects[i], rects[j])).toBe(false);
        }
      }
    });
  }

  it('n=1: fills the entire region', () => {
    const rects = mosaic([1.5], REGION);
    expect(rects).toHaveLength(1);
    const r = rects[0];
    expect(r.x).toBeCloseTo(REGION.x, 6);
    expect(r.y).toBeCloseTo(REGION.y, 6);
    expect(r.w).toBeCloseTo(REGION.w, 6);
    expect(r.h).toBeCloseTo(REGION.h, 6);
  });

  it('n=6 landscape: greedy picks the closest-aspect photo for the hero cell', () => {
    // Template for n=6 L has a distinctive top-left hero of aspect ~1.667
    // (2/3 * canvasW  by  1/2 * canvasH  in a 1000x800 region).
    // With these aspects, the input at index 1 (1.5) is the unique closest
    // match by log-distance and should be assigned to that biggest cell.
    const aspects = [1.0, 1.5, 0.5, 0.7, 0.8, 0.9];
    const rects = mosaic(aspects, REGION);
    const areas = rects.map((r) => r.w * r.h);
    const biggestIdx = areas.indexOf(Math.max(...areas));
    expect(biggestIdx).toBe(1);
  });
});
