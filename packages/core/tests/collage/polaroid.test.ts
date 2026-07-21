import { describe, expect, it } from 'vitest';
import {
  polaroid,
  type InnerRegion,
} from '../../src/collage/index.js';

const REGION: InnerRegion = { x: 0, y: 0, w: 1000, h: 800, gap: 0 };

describe('polaroid', () => {
  it('empty aspects returns []', () => {
    expect(polaroid([], REGION)).toEqual([]);
  });

  it('returns one placement per photo', () => {
    const aspects = [1, 1.5, 0.75, 2, 0.5];
    const out = polaroid(aspects, REGION);
    expect(out).toHaveLength(aspects.length);
  });

  it('every placement has a positive frame size and finite rotation', () => {
    const aspects = [1, 1.5, 0.75, 2, 0.5];
    const out = polaroid(aspects, REGION);
    for (const p of out) {
      expect(p.polaroid.frameW).toBeGreaterThan(0);
      expect(p.polaroid.frameH).toBeGreaterThan(0);
      expect(Number.isFinite(p.rotation)).toBe(true);
      // Rotation magnitude cap: 12deg = 12*PI/180 rad.
      expect(Math.abs(p.rotation)).toBeLessThanOrEqual((12 * Math.PI) / 180);
    }
  });

  it('is deterministic: same input + same seed => byte-identical output', () => {
    const aspects = [1, 1.5, 0.75, 2, 0.5];
    const a = polaroid(aspects, REGION, 0);
    const b = polaroid(aspects, REGION, 0);
    expect(b).toEqual(a);
  });

  it('default seed matches explicit seed=0', () => {
    const aspects = [1, 1.5, 0.75];
    expect(polaroid(aspects, REGION)).toEqual(polaroid(aspects, REGION, 0));
  });

  it('different seeds yield different placements', () => {
    const aspects = [1, 1.5, 0.75];
    const a = polaroid(aspects, REGION, 0);
    const b = polaroid(aspects, REGION, 7);
    // cx values should differ between the two seeds for at least one photo.
    let differs = false;
    for (let i = 0; i < aspects.length; i++) {
      if (a[i].polaroid.cx !== b[i].polaroid.cx) {
        differs = true;
        break;
      }
    }
    expect(differs).toBe(true);
  });

  it('at seed=0 reproduces the source PRNG exactly for i=0', () => {
    // The source's fixed formula (byte-identical):
    //   cx = innerX + margin + rand(i*2 + 1) * (innerW - 2*margin);
    //   cy = innerY + margin + rand(i*2 + 2) * (innerH - 2*margin);
    //   rotation = (rand(i*2 + 3) * 2 - 1) * maxRot;
    // where rand(seed) = frac(sin(seed*9301 + 49297) * 233280).
    const rand = (seed: number): number => {
      const x = Math.sin(seed * 9301 + 49297) * 233280;
      return x - Math.floor(x);
    };
    const aspects = [1.25];
    const [p] = polaroid(aspects, REGION, 0);
    const targetW = Math.sqrt((REGION.w * REGION.h) / 1) * 1.2;
    const borderSide = targetW * 0.06;
    const borderBottom = targetW * 0.22;
    const maxRot = (12 * Math.PI) / 180;
    const frameW = targetW + 2 * borderSide;
    const frameH = targetW / 1.25 + borderSide + borderBottom;
    const margin = Math.min(frameW, frameH) * 0.3;
    const expectedCx = REGION.x + margin + rand(1) * (REGION.w - 2 * margin);
    const expectedCy = REGION.y + margin + rand(2) * (REGION.h - 2 * margin);
    const expectedRot = (rand(3) * 2 - 1) * maxRot;
    expect(p.polaroid.cx).toBeCloseTo(expectedCx, 10);
    expect(p.polaroid.cy).toBeCloseTo(expectedCy, 10);
    expect(p.rotation).toBeCloseTo(expectedRot, 10);
    expect(p.polaroid.frameW).toBeCloseTo(frameW, 10);
    expect(p.polaroid.frameH).toBeCloseTo(frameH, 10);
    expect(p.polaroid.borderSide).toBeCloseTo(borderSide, 10);
    expect(p.polaroid.borderBottom).toBeCloseTo(borderBottom, 10);
  });
});
