import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { DECISION_MAX_SIDE, DECISION_MIN_SIDE, fitForDecision } from '../src/index.js';

async function blank(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: '#888' } }).jpeg().toBuffer();
}

async function dims(jpeg: Buffer): Promise<[number, number]> {
  const m = await sharp(jpeg).metadata();
  return [m.width!, m.height!];
}

describe('fitForDecision', () => {
  it('leaves already-valid images alone', async () => {
    const src = await blank(512, 384);
    const out = await fitForDecision(src);
    expect(out).toBe(src);
  });

  it('upscales a short side under the minimum', async () => {
    const [w, h] = await dims(await fitForDecision(await blank(100, 60)));
    expect(Math.min(w, h)).toBeGreaterThanOrEqual(DECISION_MIN_SIDE);
    expect(Math.max(w, h)).toBeLessThanOrEqual(DECISION_MAX_SIDE);
  });

  it('downscales and pads a very wide image', async () => {
    const [w, h] = await dims(await fitForDecision(await blank(4000, 200)));
    expect(Math.min(w, h)).toBeGreaterThanOrEqual(DECISION_MIN_SIDE);
    expect(Math.max(w, h)).toBeLessThanOrEqual(DECISION_MAX_SIDE);
  });
});
