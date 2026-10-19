import { describe, expect, it } from 'vitest';
import { PAD_RATIO, paddedRect, paddedSize } from '../src/padded-rect.js';

describe('paddedSize', () => {
  it('adds the default ratio on each side', () => {
    expect(PAD_RATIO).toBe(0.02);
    expect(paddedSize(100, 50)).toEqual({ padX: 2, padY: 1, width: 104, height: 52 });
  });
});

describe('paddedRect', () => {
  it('expands a crop that sits inside the bounds', () => {
    expect(paddedRect({ x: 10, y: 20, width: 100, height: 50 }, 200, 200)).toEqual({
      x: 8,
      y: 19,
      width: 104,
      height: 52,
    });
  });

  it('clamps an expansion that would leave the image', () => {
    expect(paddedRect({ x: 1, y: 0, width: 100, height: 40 }, 102, 40)).toEqual({
      x: 0,
      y: 0,
      width: 102,
      height: 40,
    });
  });
});
