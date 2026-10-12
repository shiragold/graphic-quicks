/** Fraction of the photo's width and height added on each side of a tight crop. */
export const PAD_RATIO = 0.02;

export interface PaddedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Size of a tight crop expanded by `padRatio` on every side, with no clamping.
 * Ground-truth padded canvases use this; on-image crops use {@link paddedRect}.
 */
export function paddedSize(
  width: number,
  height: number,
  padRatio = PAD_RATIO,
): { padX: number; padY: number; width: number; height: number } {
  const padX = Math.round(width * padRatio);
  const padY = Math.round(height * padRatio);
  return { padX, padY, width: width + 2 * padX, height: height + 2 * padY };
}

/**
 * Expand `bbox` by `padRatio` on every side and clamp it to
 * `[0, boundsWidth) × [0, boundsHeight)`.
 */
export function paddedRect(
  bbox: PaddedRect,
  boundsWidth: number,
  boundsHeight: number,
  padRatio = PAD_RATIO,
): PaddedRect {
  const pad = paddedSize(bbox.width, bbox.height, padRatio);
  const x = Math.max(0, bbox.x - pad.padX);
  const y = Math.max(0, bbox.y - pad.padY);
  return {
    x,
    y,
    width: Math.min(boundsWidth - x, pad.width),
    height: Math.min(boundsHeight - y, pad.height),
  };
}
