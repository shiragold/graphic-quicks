import { describe, expect, it } from 'vitest';
import { polaroid, type InnerRegion, type PolaroidPlacement } from '../src/index.js';

const REGION: InnerRegion = { x: 0, y: 0, w: 1000, h: 800, gap: 12 };
const MAX_ROT = (4 * Math.PI) / 180;

function corners(p: PolaroidPlacement): Array<[number, number]> {
  const { cx, cy, frameW, frameH } = p.polaroid;
  const cos = Math.cos(p.rotation);
  const sin = Math.sin(p.rotation);
  const dx = frameW / 2;
  const dy = frameH / 2;
  return [
    [-dx, -dy],
    [dx, -dy],
    [dx, dy],
    [-dx, dy],
  ].map(([x, y]) => [cx + x * cos - y * sin, cy + x * sin + y * cos]);
}

describe('polaroid', () => {
  it('empty aspects returns []', () => {
    expect(polaroid([], REGION)).toEqual([]);
  });

  it('returns one placement per photo', () => {
    const aspects = [1, 1.5, 0.75, 2, 0.5];
    const out = polaroid(aspects, REGION);
    expect(out).toHaveLength(aspects.length);
  });

  it('overlaps neighbors by a few pixels without covering the photos', () => {
    const out = polaroid([1, 1, 1, 1], REGION, 2);
    const { frameW, frameH, borderSide } = out[0].polaroid;
    const photoW = frameW - 2 * borderSide;
    const photoH = frameH - borderSide - out[0].polaroid.borderBottom;

    for (const pair of [
      [0, 1],
      [2, 3],
    ] as const) {
      const dx = Math.abs(out[pair[1]].polaroid.cx - out[pair[0]].polaroid.cx);
      const overlap = frameW - dx;
      expect(overlap).toBeGreaterThan(0);
      expect(overlap).toBeLessThanOrEqual(8 + 4 + 4);
      expect(dx).toBeGreaterThan(photoW);
    }
    for (const pair of [
      [0, 2],
      [1, 3],
    ] as const) {
      const dy = Math.abs(out[pair[1]].polaroid.cy - out[pair[0]].polaroid.cy);
      const overlap = frameH - dy;
      expect(overlap).toBeGreaterThan(0);
      expect(overlap).toBeLessThanOrEqual(8 + 4 + 4);
      expect(dy).toBeGreaterThan(photoH);
    }
  });

  it('keeps every tilted card inside the region', () => {
    const aspects = [1, 1.5, 0.75, 2, 0.5, 1.2];
    const out = polaroid(aspects, REGION, 3);
    for (const p of out) {
      expect(Math.abs(p.rotation)).toBeLessThanOrEqual(MAX_ROT + 1e-9);
      for (const [x, y] of corners(p)) {
        expect(x).toBeGreaterThanOrEqual(REGION.x - 1e-6);
        expect(x).toBeLessThanOrEqual(REGION.x + REGION.w + 1e-6);
        expect(y).toBeGreaterThanOrEqual(REGION.y - 1e-6);
        expect(y).toBeLessThanOrEqual(REGION.y + REGION.h + 1e-6);
      }
    }
  });

  it('is deterministic: same input + same seed => byte-identical output', () => {
    const aspects = [1, 1.5, 0.75, 2, 0.5];
    expect(polaroid(aspects, REGION, 0)).toEqual(polaroid(aspects, REGION, 0));
  });

  it('default seed matches explicit seed=0', () => {
    const aspects = [1, 1.5, 0.75];
    expect(polaroid(aspects, REGION)).toEqual(polaroid(aspects, REGION, 0));
  });

  it('different seeds change the arrangement', () => {
    const aspects = [1, 1, 1, 1];
    const a = polaroid(aspects, REGION, 0);
    const b = polaroid(aspects, REGION, 7);
    const moved = a.some(
      (p, i) =>
        p.polaroid.cx !== b[i].polaroid.cx ||
        p.polaroid.cy !== b[i].polaroid.cy ||
        p.rotation !== b[i].rotation,
    );
    const restacked = a.some((p, i) => p.z !== b[i].z);
    expect(moved).toBe(true);
    expect(restacked).toBe(true);
  });
});
