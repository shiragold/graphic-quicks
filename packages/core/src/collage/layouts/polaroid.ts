import type { InnerRegion, PolaroidPlacement } from '../types.js';

/**
 * Scattered polaroid layout. Each photo becomes a small white-framed
 * card at a deterministic pseudo-random position and rotation. Target
 * card width is `sqrt(area / n) * 1.2` so cards overlap a little.
 *
 * The PRNG is `Math.sin(seed * 9301 + 49297) * 233280` (mod 1). Passing
 * `seed` (default `0`) shifts every draw by an additive offset; with
 * `seed = 0` output is byte-identical to the source's fixed sequence.
 */
export function polaroid(
  aspects: readonly number[],
  region: InnerRegion,
  seed = 0,
): PolaroidPlacement[] {
  const n = aspects.length;
  if (n === 0) return [];

  const { x: innerX, y: innerY, w: innerW, h: innerH } = region;

  // Target polaroid photo-content width ~= sqrt(canvasArea / n) * 1.2
  // so a few overlap nicely.
  const targetW = Math.sqrt((innerW * innerH) / Math.max(n, 1)) * 1.2;
  const borderSide = targetW * 0.06;
  const borderBottom = targetW * 0.22;
  const maxRot = (12 * Math.PI) / 180;

  const out: PolaroidPlacement[] = new Array<PolaroidPlacement>(n);
  for (let i = 0; i < n; i++) {
    const ar = aspects[i];
    const photoW = targetW;
    const photoH = targetW / ar;
    const frameW = photoW + 2 * borderSide;
    const frameH = photoH + borderSide + borderBottom;
    const margin = Math.min(frameW, frameH) * 0.3;
    const cx = innerX + margin + rand(seed + i * 2 + 1) * (innerW - 2 * margin);
    const cy = innerY + margin + rand(seed + i * 2 + 2) * (innerH - 2 * margin);
    const rotation = (rand(seed + i * 2 + 3) * 2 - 1) * maxRot;
    out[i] = {
      rotation,
      polaroid: { borderSide, borderBottom, cx, cy, frameW, frameH },
    };
  }
  return out;
}

function rand(seed: number): number {
  const x = Math.sin(seed * 9301 + 49297) * 233280;
  return x - Math.floor(x);
}
