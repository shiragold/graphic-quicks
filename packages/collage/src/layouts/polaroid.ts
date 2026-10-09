import type { InnerRegion, PolaroidPlacement } from '../types.js';

const BORDER_SIDE = 0.06;
const BORDER_BOTTOM = 0.22;
/** A few degrees, so a tilted corner adds only a slight extra overlap. */
const MAX_ROT = (4 * Math.PI) / 180;
/** How far neighboring frames cross, in canvas pixels. */
const OVERLAP_PX = 8;
/** Position wobble. Kept under the overlap so a card cannot cover its neighbor's photo. */
const JITTER_PX = 4;

/**
 * Polaroid wall. Same-sized cards sit on a grid and cross their neighbors
 * by a few pixels — enough to tuck the white borders together, not enough
 * to cover a photo. `seed` changes the tilt, the few-pixel shift, and the
 * stacking order. The same seed repeats the same arrangement.
 */
export function polaroid(
  aspects: readonly number[],
  region: InnerRegion,
  seed = 0,
): PolaroidPlacement[] {
  const n = aspects.length;
  if (n === 0) return [];

  const { x: innerX, y: innerY, w: innerW, h: innerH } = region;
  const cols = columnCount(n, innerW, innerH);
  const rows = Math.ceil(n / cols);
  const fitted = frameForCell(innerW / cols, innerH / rows);
  const overlap = Math.min(OVERLAP_PX, fitted.borderSide * 0.45);
  const jitter = Math.min(JITTER_PX, overlap / 2);
  const aabb = rotatedAabb(fitted.frameW, fitted.frameH, MAX_ROT);
  const insetX = (aabb.w - fitted.frameW) / 2;
  const insetY = (aabb.h - fitted.frameH) / 2;
  const scale = Math.min(
    1,
    axisScale(innerW, cols, fitted.frameW, overlap, insetX),
    axisScale(innerH, rows, fitted.frameH, overlap, insetY),
  );
  const frameW = fitted.frameW * scale;
  const frameH = fitted.frameH * scale;
  const borderSide = fitted.borderSide * scale;
  const borderBottom = fitted.borderBottom * scale;
  const safeInsetX = insetX * scale;
  const safeInsetY = insetY * scale;
  const packX = packAxis(innerX, innerW, cols, frameW, overlap, safeInsetX);
  const packY = packAxis(innerY, innerH, rows, frameH, overlap, safeInsetY);

  const out: PolaroidPlacement[] = new Array<PolaroidPlacement>(n);
  for (let i = 0; i < n; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const rotation = (rand(seed + i * 3 + 1) * 2 - 1) * MAX_ROT;
    const placed = clampCenter(
      packX.origin + col * packX.pitch + (rand(seed + i * 3 + 2) * 2 - 1) * jitter,
      packY.origin + row * packY.pitch + (rand(seed + i * 3 + 3) * 2 - 1) * jitter,
      frameW,
      frameH,
      rotation,
      region,
    );
    out[i] = {
      rotation,
      z: rand(seed + i * 3 + 4),
      polaroid: {
        borderSide,
        borderBottom,
        frameW,
        frameH,
        cx: placed.cx,
        cy: placed.cy,
      },
    };
  }
  return out;
}

function columnCount(n: number, innerW: number, innerH: number): number {
  const aspect = innerW / Math.max(innerH, 1);
  return Math.min(n, Math.max(1, Math.round(Math.sqrt(n * aspect))));
}

function frameForCell(cellW: number, cellH: number): {
  borderSide: number;
  borderBottom: number;
  frameW: number;
  frameH: number;
} {
  const frameRatio = (1 + BORDER_SIDE + BORDER_BOTTOM) / (1 + 2 * BORDER_SIDE);
  const cos = Math.cos(MAX_ROT);
  const sin = Math.sin(MAX_ROT);
  const frameW = Math.min(
    cellW / (cos + frameRatio * sin),
    cellH / (sin + frameRatio * cos),
  );
  const photo = frameW / (1 + 2 * BORDER_SIDE);
  const borderSide = photo * BORDER_SIDE;
  const borderBottom = photo * BORDER_BOTTOM;
  return {
    borderSide,
    borderBottom,
    frameW,
    frameH: photo + borderSide + borderBottom,
  };
}

function rotatedAabb(
  frameW: number,
  frameH: number,
  rotation: number,
): { w: number; h: number } {
  const cos = Math.abs(Math.cos(rotation));
  const sin = Math.abs(Math.sin(rotation));
  return {
    w: frameW * cos + frameH * sin,
    h: frameW * sin + frameH * cos,
  };
}

/** Scale that lets `count` frames overlap and still fit the axis. */
function axisScale(
  inner: number,
  count: number,
  frame: number,
  overlap: number,
  inset: number,
): number {
  const available = inner - 2 * inset;
  const cluster = count * frame - (count - 1) * overlap;
  if (cluster <= available || frame <= 0) return 1;
  return (available + (count - 1) * overlap) / (count * frame);
}

function packAxis(
  start: number,
  inner: number,
  count: number,
  size: number,
  overlap: number,
  inset: number,
): { origin: number; pitch: number } {
  const available = inner - 2 * inset;
  const pitch = count === 1 ? 0 : size - overlap;
  const cluster = count * size - (count - 1) * overlap;
  const origin = start + inset + (available - cluster) / 2 + size / 2;
  return { origin, pitch };
}

function clampCenter(
  cx: number,
  cy: number,
  frameW: number,
  frameH: number,
  rotation: number,
  region: InnerRegion,
): { cx: number; cy: number } {
  const aabb = rotatedAabb(frameW, frameH, rotation);
  const minX = region.x + aabb.w / 2;
  const maxX = region.x + region.w - aabb.w / 2;
  const minY = region.y + aabb.h / 2;
  const maxY = region.y + region.h - aabb.h / 2;
  return {
    cx: minX <= maxX ? Math.min(maxX, Math.max(minX, cx)) : (minX + maxX) / 2,
    cy: minY <= maxY ? Math.min(maxY, Math.max(minY, cy)) : (minY + maxY) / 2,
  };
}

function rand(seed: number): number {
  const x = Math.sin(seed * 9301 + 49297) * 233280;
  return x - Math.floor(x);
}
