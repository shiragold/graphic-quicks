import { describe, expect, it } from 'vitest';

import {
  SUPPORTED_SCALE_FACTORS,
  computeScaledSize,
  type ScaleFactor,
} from '../../src/scale/index.js';

describe('computeScaledSize', () => {
  it('doubles both dimensions for factor=2', () => {
    expect(computeScaledSize({ width: 100, height: 50 }, 2)).toEqual({
      width: 200,
      height: 100,
    });
  });

  it.each<[ScaleFactor, number, number]>([
    [2, 1280, 960],
    [3, 1920, 1440],
    [4, 2560, 1920],
    [8, 5120, 3840],
  ])('scales 640x480 by factor %i to %ix%i', (factor, expectedWidth, expectedHeight) => {
    expect(computeScaledSize({ width: 640, height: 480 }, factor)).toEqual({
      width: expectedWidth,
      height: expectedHeight,
    });
  });

  it('rounds fractional results', () => {
    expect(computeScaledSize({ width: 100.4, height: 100.6 }, 1)).toEqual({
      width: 100,
      height: 101,
    });
  });

  it('throws on factor <= 0', () => {
    expect(() => computeScaledSize({ width: 100, height: 100 }, 0)).toThrow(RangeError);
    expect(() => computeScaledSize({ width: 100, height: 100 }, -2)).toThrow(RangeError);
  });

  it('throws on non-finite width', () => {
    expect(() =>
      computeScaledSize({ width: Number.POSITIVE_INFINITY, height: 100 }, 2),
    ).toThrow(RangeError);
    expect(() => computeScaledSize({ width: Number.NaN, height: 100 }, 2)).toThrow(RangeError);
  });

  it('throws on negative height', () => {
    expect(() => computeScaledSize({ width: 100, height: -10 }, 2)).toThrow(RangeError);
  });

  it('exports SUPPORTED_SCALE_FACTORS containing 2, 3, 4, 8', () => {
    expect(SUPPORTED_SCALE_FACTORS).toEqual([2, 3, 4, 8]);
  });
});
