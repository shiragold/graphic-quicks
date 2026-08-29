import { describe, it, expect } from 'vitest';
import type { Mat } from '@techstark/opencv-js';
import { makePhoto, toMat, compareImages, type Fixture } from './fixtures.js';
import {
  sampleBackgroundColor,
  detectSkewAngle,
  detectPhotoBBox,
  processMat,
} from '../photo-edit.js';

describe('sampleBackgroundColor', () => {
  it('matches the rendered background within tolerance', () => {
    const fx = makePhoto({ bgColor: [240, 240, 240] });
    const m = toMat(fx.input);
    try {
      const [r, g, b] = sampleBackgroundColor(m);
      expect(Math.abs(r - 240)).toBeLessThanOrEqual(2);
      expect(Math.abs(g - 240)).toBeLessThanOrEqual(2);
      expect(Math.abs(b - 240)).toBeLessThanOrEqual(2);
    } finally {
      m.delete();
    }
  });
});

describe('detectSkewAngle', () => {
  it.each([0, 3, -5, 10, -12])('detects %i deg within +/-1 deg', (deg) => {
    const m = toMat(makePhoto({ angleDeg: deg }).input);
    try {
      expect(Math.abs(detectSkewAngle(m) - deg)).toBeLessThanOrEqual(1);
    } finally {
      m.delete();
    }
  });
});

describe('detectPhotoBBox', () => {
  it('finds a centered un-rotated photo within a few px of its true rect', () => {
    const fx = makePhoto({ photoW: 400, photoH: 300, cx: 400, cy: 300, angleDeg: 0 });
    const m = toMat(fx.input);
    try {
      const r = detectPhotoBBox(m, fx.expected.bgColor);
      expect(r).not.toBeNull();
      expect(Math.abs(r!.x - fx.expected.bboxOriginal.x)).toBeLessThanOrEqual(3);
      expect(Math.abs(r!.y - fx.expected.bboxOriginal.y)).toBeLessThanOrEqual(3);
      expect(Math.abs(r!.width - fx.expected.bboxOriginal.w)).toBeLessThanOrEqual(6);
      expect(Math.abs(r!.height - fx.expected.bboxOriginal.h)).toBeLessThanOrEqual(6);
    } finally {
      m.delete();
    }
  });

  it('returns null on a blank background', () => {
    const m = toMat(makePhoto({ photoW: 0, photoH: 0 }).input);
    try {
      expect(detectPhotoBBox(m, [240, 240, 240])).toBeNull();
    } finally {
      m.delete();
    }
  });
});

interface PipelineComparison {
  theta: number;
  tightCmp: ReturnType<typeof compareImages>;
  deTightCmp: ReturnType<typeof compareImages>;
  dePadCmp: ReturnType<typeof compareImages>;
}

// Runs the full pipeline against a fixture, produces the 3 output crops the
// same way index.html does, and compares each to its ground-truth image.
function runPipelineAndCompare(fx: Fixture): PipelineComparison {
  const src = toMat(fx.input);
  const out = processMat(src);
  let tight: Mat = src;
  let deTight: Mat = out.rotated;
  let dePadded: Mat = out.rotated;
  let tightOwned = false;
  let deTightOwned = false;
  let dePadOwned = false;
  try {
    if (out.bboxOriginal) {
      tight = src.roi(out.bboxOriginal);
      tightOwned = true;
    }
    if (out.bboxRotated) {
      deTight = out.rotated.roi(out.bboxRotated);
      deTightOwned = true;
      const padX = Math.round(out.bboxRotated.width * 0.02);
      const padY = Math.round(out.bboxRotated.height * 0.02);
      const px = Math.max(0, out.bboxRotated.x - padX);
      const py = Math.max(0, out.bboxRotated.y - padY);
      const pw = Math.min(out.rotated.cols - px, out.bboxRotated.width + 2 * padX);
      const ph = Math.min(out.rotated.rows - py, out.bboxRotated.height + 2 * padY);
      dePadded = out.rotated.roi(new cv.Rect(px, py, pw, ph));
      dePadOwned = true;
    }
    return {
      theta: out.theta,
      tightCmp: compareImages(tight, fx.expected.outputs.tightCrop),
      deTightCmp: compareImages(deTight, fx.expected.outputs.deskewedTight),
      dePadCmp: compareImages(dePadded, fx.expected.outputs.deskewedPadded),
    };
  } finally {
    if (tightOwned) tight.delete();
    if (deTightOwned) deTight.delete();
    if (dePadOwned) dePadded.delete();
    out.rotated.delete();
    src.delete();
  }
}

describe('processMat outputs match ground-truth images', () => {
  // Per-channel mean-diff threshold (0..255). Solid-color regions should be
  // near-zero; warpAffine sampling adds a small bias even with a borderPx mask.
  const MEAN_DIFF = 8;

  it.each([
    { name: 'clean-0deg', opts: { angleDeg: 0 } },
    { name: 'tilted-+5deg', opts: { angleDeg: 5 } },
    { name: 'tilted--10deg', opts: { angleDeg: -10 } },
    { name: 'off-center', opts: { cx: 300, cy: 400 } },
  ])('$name', ({ opts }) => {
    const fx = makePhoto(opts);
    const { tightCmp, deTightCmp, dePadCmp } = runPipelineAndCompare(fx);
    expect(tightCmp.meanDiff).toBeLessThan(MEAN_DIFF);
    expect(deTightCmp.meanDiff).toBeLessThan(MEAN_DIFF);
    expect(dePadCmp.meanDiff).toBeLessThan(MEAN_DIFF);
  });
});
