export interface ImageSize {
  width: number;
  height: number;
}

/**
 * Scale factors supported by the original image-scale app.
 * Kept as a union so callers get autocomplete + type-checking, but the
 * runtime helper accepts any positive number.
 */
export type ScaleFactor = 2 | 3 | 4 | 8;
