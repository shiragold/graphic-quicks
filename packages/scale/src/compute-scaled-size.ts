import type { ImageSize, ScaleFactor } from './types.js';

/**
 * Returns the target size when scaling `size` by `factor`.
 *
 * Matches the arithmetic in image-scale.html:
 *   newWidth  = width  * factor
 *   newHeight = height * factor
 *
 * Rounds each dimension to the nearest integer (image-scale.html implicitly
 * gets integer output because it always operates on integer widths — this
 * helper is safe for non-integer inputs too).
 *
 * Throws RangeError if factor <= 0 or if width/height are not finite
 * positive numbers.
 */
export function computeScaledSize(size: ImageSize, factor: number): ImageSize {
  if (!Number.isFinite(factor) || factor <= 0) {
    throw new RangeError(
      `computeScaledSize: factor must be a finite positive number, received ${String(factor)}`,
    );
  }

  const { width, height } = size;

  if (!Number.isFinite(width) || width <= 0) {
    throw new RangeError(
      `computeScaledSize: size.width must be a finite positive number, received ${String(width)}`,
    );
  }

  if (!Number.isFinite(height) || height <= 0) {
    throw new RangeError(
      `computeScaledSize: size.height must be a finite positive number, received ${String(height)}`,
    );
  }

  return {
    width: Math.round(width * factor),
    height: Math.round(height * factor),
  };
}

/**
 * The scale factors the original UI exposes (2x, 3x, 4x, 8x). Handy for
 * building a dropdown / preset list.
 */
export const SUPPORTED_SCALE_FACTORS: readonly ScaleFactor[] = [2, 3, 4, 8] as const;
