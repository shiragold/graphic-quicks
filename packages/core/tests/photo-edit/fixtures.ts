import type { Mat, CV } from '@techstark/opencv-js';
import type { RGB } from '../../src/photo-edit/index.js';

// `cv` resolves to `globalThis.cv`, which tests/setup.ts populates before any
// test runs.
declare const cv: CV;

export interface FixtureOptions {
  canvasW?: number;
  canvasH?: number;
  photoW?: number;
  photoH?: number;
  cx?: number;
  cy?: number;
  angleDeg?: number;
  photoColor?: RGB;
  bgColor?: RGB;
}

export interface RawImage {
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface Fixture {
  input: RawImage;
  expected: {
    angleDeg: number;
    bgColor: RGB;
    photoColor: RGB;
    photoW: number;
    photoH: number;
    bboxOriginal: { x: number; y: number; w: number; h: number };
    outputs: {
      tightCrop: RawImage;
      deskewedTight: RawImage;
      deskewedPadded: RawImage;
    };
  };
}

// Renders bgColor everywhere, then fills the rotated rect with photoColor.
// Used both for inputs (rotated photo on a canvas) and for ground-truth
// outputs (axis-aligned photo in a tight or padded canvas).
function renderScene(
  width: number,
  height: number,
  cx: number,
  cy: number,
  photoW: number,
  photoH: number,
  angleDeg: number,
  photoColor: RGB,
  bgColor: RGB,
): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = bgColor[0];
    rgba[i + 1] = bgColor[1];
    rgba[i + 2] = bgColor[2];
    rgba[i + 3] = 255;
  }
  if (photoW <= 0 || photoH <= 0) return rgba;

  const rad = (-angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const hx = photoW / 2;
  const hy = photoH / 2;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const lx = dx * cos - dy * sin;
      const ly = dx * sin + dy * cos;
      if (Math.abs(lx) <= hx && Math.abs(ly) <= hy) {
        const off = (y * width + x) * 4;
        rgba[off] = photoColor[0];
        rgba[off + 1] = photoColor[1];
        rgba[off + 2] = photoColor[2];
        rgba[off + 3] = 255;
      }
    }
  }
  return rgba;
}

export function makePhoto(opts: FixtureOptions = {}): Fixture {
  const {
    canvasW = 800,
    canvasH = 600,
    photoW = 400,
    photoH = 300,
    cx = canvasW / 2,
    cy = canvasH / 2,
    angleDeg = 0,
    photoColor = [200, 80, 80] as RGB,
    bgColor = [240, 240, 240] as RGB,
  } = opts;

  const inputRgba = renderScene(
    canvasW, canvasH, cx, cy, photoW, photoH, angleDeg, photoColor, bgColor,
  );

  const fwd = (angleDeg * Math.PI) / 180;
  const cosFwd = Math.cos(fwd);
  const sinFwd = Math.sin(fwd);
  const localCorners: Array<[number, number]> = [
    [-photoW / 2, -photoH / 2],
    [photoW / 2, -photoH / 2],
    [photoW / 2, photoH / 2],
    [-photoW / 2, photoH / 2],
  ];
  const corners = localCorners.map<[number, number]>(([lx, ly]) => [
    cx + lx * cosFwd - ly * sinFwd,
    cy + lx * sinFwd + ly * cosFwd,
  ]);
  const xs = corners.map((c) => c[0]);
  const ys = corners.map((c) => c[1]);
  const bbx = Math.floor(Math.min(...xs));
  const bby = Math.floor(Math.min(...ys));
  const bbw = Math.ceil(Math.max(...xs)) - bbx;
  const bbh = Math.ceil(Math.max(...ys)) - bby;

  const hasPhoto = photoW > 0 && photoH > 0;
  const tightCrop: RawImage = hasPhoto
    ? {
        rgba: renderScene(
          bbw, bbh, cx - bbx, cy - bby, photoW, photoH, angleDeg, photoColor, bgColor,
        ),
        width: bbw,
        height: bbh,
      }
    : { rgba: new Uint8ClampedArray(0), width: 0, height: 0 };

  const deskewedTight: RawImage = {
    rgba: renderScene(
      photoW, photoH, photoW / 2, photoH / 2, photoW, photoH, 0, photoColor, bgColor,
    ),
    width: photoW,
    height: photoH,
  };

  const padX = Math.round(photoW * 0.02);
  const padY = Math.round(photoH * 0.02);
  const padW = photoW + 2 * padX;
  const padH = photoH + 2 * padY;
  const deskewedPadded: RawImage = {
    rgba: renderScene(
      padW, padH, padW / 2, padH / 2, photoW, photoH, 0, photoColor, bgColor,
    ),
    width: padW,
    height: padH,
  };

  return {
    input: { rgba: inputRgba, width: canvasW, height: canvasH },
    expected: {
      angleDeg,
      bgColor,
      photoColor,
      photoW,
      photoH,
      bboxOriginal: { x: bbx, y: bby, w: bbw, h: bbh },
      outputs: { tightCrop, deskewedTight, deskewedPadded },
    },
  };
}

export function toMat(img: RawImage): Mat {
  const m = new cv.Mat(img.height, img.width, cv.CV_8UC4);
  (m.data as Uint8Array).set(img.rgba);
  return m;
}

// Extract a Mat's entire content (or a sub-region) as a fresh, row-tight
// RawImage. Works around a @techstark/opencv-js quirk: `mat.roi(rect).clone()`
// does NOT re-tighten the buffer — it just memcpy's `rect.h * rect.w * 4`
// contiguous bytes starting at the ROI origin, so consecutive rows overlap
// with the parent's neighboring pixels. We copy row-by-row from `mat.data`,
// which is the safe, portable way to get a proper tight-packed crop.
export function matToRawImage(
  src: Mat,
  rect?: { x: number; y: number; width: number; height: number },
): RawImage {
  const rx = rect?.x ?? 0;
  const ry = rect?.y ?? 0;
  const rw = rect?.width ?? src.cols;
  const rh = rect?.height ?? src.rows;
  const srcRowBytes = src.cols * 4;
  const dstRowBytes = rw * 4;
  const rgba = new Uint8ClampedArray(rw * rh * 4);
  const srcData = src.data as Uint8Array;
  for (let y = 0; y < rh; y++) {
    const srcStart = (ry + y) * srcRowBytes + rx * 4;
    const dstStart = y * dstRowBytes;
    for (let i = 0; i < dstRowBytes; i++) {
      rgba[dstStart + i] = srcData[srcStart + i];
    }
  }
  return { rgba, width: rw, height: rh };
}

export interface CompareOptions {
  // Ignore this many pixels around the edge of the overlap region (warpAffine
  // + tight-crop produce ~1-2 px of edge anti-aliasing that doesn't match the
  // synthetic ground truth exactly).
  borderPx?: number;
  // If actual.cols/rows differ from expected.width/height by more than this,
  // fail the comparison hard (return Infinity).
  maxSizeDeltaPx?: number;
}

export interface CompareResult {
  meanDiff: number;
  maxDiff: number;
  comparedPixels: number;
  actualSize: { w: number; h: number };
  expectedSize: { w: number; h: number };
}

// Center-aligns actual and expected, crops to their common inner region (minus
// borderPx margin), and reports mean and max per-channel absolute difference
// over the compared pixels. Accepts either a Mat (using its .data + cols/rows)
// or a RawImage for `actual`; expected is always a RawImage. When given a Mat,
// this is only safe if the Mat's data buffer is row-tight (cols*rows*4 bytes
// with stride == cols*4) — for ROIs, first convert with matToRawImage.
export function compareImages(
  actual: Mat | RawImage,
  expected: RawImage,
  opts: CompareOptions = {},
): CompareResult {
  const { borderPx = 3, maxSizeDeltaPx = 12 } = opts;
  const aW = 'cols' in actual ? actual.cols : actual.width;
  const aH = 'cols' in actual ? actual.rows : actual.height;
  const aData: Uint8Array | Uint8ClampedArray =
    'cols' in actual ? (actual.data as Uint8Array) : actual.rgba;
  const eW = expected.width;
  const eH = expected.height;
  if (Math.abs(aW - eW) > maxSizeDeltaPx || Math.abs(aH - eH) > maxSizeDeltaPx) {
    return {
      meanDiff: Infinity,
      maxDiff: Infinity,
      comparedPixels: 0,
      actualSize: { w: aW, h: aH },
      expectedSize: { w: eW, h: eH },
    };
  }
  const w = Math.min(aW, eW);
  const h = Math.min(aH, eH);
  const aOffX = Math.floor((aW - w) / 2);
  const aOffY = Math.floor((aH - h) / 2);
  const eOffX = Math.floor((eW - w) / 2);
  const eOffY = Math.floor((eH - h) / 2);
  let sum = 0;
  let max = 0;
  let count = 0;
  for (let y = borderPx; y < h - borderPx; y++) {
    for (let x = borderPx; x < w - borderPx; x++) {
      const aOff = ((y + aOffY) * aW + (x + aOffX)) * 4;
      const eOff = ((y + eOffY) * eW + (x + eOffX)) * 4;
      for (let c = 0; c < 3; c++) {
        const d = Math.abs(aData[aOff + c] - expected.rgba[eOff + c]);
        sum += d;
        if (d > max) max = d;
        count++;
      }
    }
  }
  return {
    meanDiff: count === 0 ? Infinity : sum / count,
    maxDiff: max,
    comparedPixels: count,
    actualSize: { w: aW, h: aH },
    expectedSize: { w: eW, h: eH },
  };
}

export async function writePng(img: RawImage, outPath: string): Promise<void> {
  const { PNG } = await import('pngjs');
  const fs = await import('node:fs');
  const png = new PNG({ width: img.width, height: img.height });
  png.data = Buffer.from(img.rgba.buffer, img.rgba.byteOffset, img.rgba.byteLength);
  await new Promise<void>((resolve, reject) => {
    png
      .pack()
      .pipe(fs.createWriteStream(outPath))
      .on('finish', () => resolve())
      .on('error', reject);
  });
}
