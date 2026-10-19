import { describe, expect, it } from 'vitest';

import {
  MAX_CANVAS_AREA,
  MAX_CANVAS_DIMENSION,
  assertWithinCanvasLimits,
} from '../src/index.js';

describe('assertWithinCanvasLimits', () => {
  it('accepts sizes within the limits', () => {
    expect(() => assertWithinCanvasLimits({ width: 1920, height: 1080 })).not.toThrow();
  });

  it('accepts the maximum square exactly', () => {
    expect(() =>
      assertWithinCanvasLimits({ width: MAX_CANVAS_DIMENSION, height: MAX_CANVAS_DIMENSION }),
    ).not.toThrow();
  });

  it('throws when width exceeds the dimension limit', () => {
    expect(() =>
      assertWithinCanvasLimits({ width: MAX_CANVAS_DIMENSION + 1, height: 100 }),
    ).toThrow(/canvas dimension limit/);
  });

  it('throws when height exceeds the dimension limit', () => {
    expect(() =>
      assertWithinCanvasLimits({ width: 100, height: MAX_CANVAS_DIMENSION + 1 }),
    ).toThrow(/canvas dimension limit/);
  });

  it('mentions the offending size and limit in the dimension error', () => {
    expect(() => assertWithinCanvasLimits({ width: 20000, height: 100 })).toThrow(
      `Target size 20000 × 100px exceeds the ${MAX_CANVAS_DIMENSION}px canvas dimension limit`,
    );
  });

  it('throws RangeError, not a plain Error', () => {
    expect(() => assertWithinCanvasLimits({ width: 20000, height: 100 })).toThrow(RangeError);
  });

  it('reports the dimension error (checked first) for an oversized square', () => {
    // With the current constants the area cap equals the dimension cap
    // squared, so the dimension check always fires first; the area check is a
    // guard in case the caps ever diverge (some browsers cap area lower).
    expect(() => assertWithinCanvasLimits({ width: 20000, height: 20000 })).toThrow(
      /canvas dimension limit/,
    );
  });

  it('exports the documented limit values', () => {
    expect(MAX_CANVAS_DIMENSION).toBe(16384);
    expect(MAX_CANVAS_AREA).toBe(16384 * 16384);
  });
});
