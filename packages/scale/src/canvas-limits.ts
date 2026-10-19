import type { ImageSize } from './types.js';

/**
 * Browser canvas limits: exceeding them silently produces a blank canvas.
 *
 * 16384px is the per-dimension cap shared by current Chromium, Firefox and
 * Safari; the area cap matches a 16384 × 16384 square.
 */
export const MAX_CANVAS_DIMENSION = 16384;
export const MAX_CANVAS_AREA = 268435456; // 16384 * 16384

/**
 * Throws RangeError if `size` exceeds the browser canvas dimension or area
 * limits. Pure arithmetic — no Canvas API is touched; callers that are about
 * to allocate a canvas of this size should call this first, because browsers
 * fail silently (blank canvas) rather than throwing.
 */
export function assertWithinCanvasLimits(size: ImageSize): void {
  const { width, height } = size;

  if (width > MAX_CANVAS_DIMENSION || height > MAX_CANVAS_DIMENSION) {
    throw new RangeError(
      `Target size ${width} × ${height}px exceeds the ${MAX_CANVAS_DIMENSION}px canvas dimension limit`,
    );
  }
  if (width * height > MAX_CANVAS_AREA) {
    throw new RangeError(
      `Target area ${width} × ${height}px exceeds the browser canvas area limit`,
    );
  }
}
