/**
 * Public type surface for the collage layout module.
 *
 * All coordinates and sizes are in "canvas units" — the same unitless
 * space the caller uses for `width`/`height` in {@link CollageSettings}.
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * A rotated white-framed polaroid card. The card is centered at `(cx, cy)`
 * with an unrotated bounding box of `frameW x frameH`. Callers render by:
 *   1. translate to (cx, cy)
 *   2. rotate by `rotation` radians
 *   3. fill a white rect of size (frameW x frameH) centered at origin
 *   4. cover-fit the photo into the inner window
 *      (`frameW - 2*borderSide` x `frameH - borderSide - borderBottom`)
 */
export interface PolaroidPlacement {
  rotation: number;
  polaroid: {
    borderSide: number;
    borderBottom: number;
    cx: number;
    cy: number;
    frameW: number;
    frameH: number;
  };
}

export type CollagePlacement = Rect | PolaroidPlacement;

export type LayoutKind =
  | 'justified-rows'
  | 'justified-cols'
  | 'grid'
  | 'columns'
  | 'hero-grid'
  | 'mosaic'
  | 'polaroid'
  | 'row'
  | 'column';

export type HeroPosition = 'start' | 'center' | 'end';

export interface CollageSettings {
  width: number;
  height: number;
  layout: LayoutKind;
  columns?: number;
  gap?: number;
  padding?: number;
  heroPos?: HeroPosition;
  polaroidSeed?: number;
}

/**
 * The interior region a layout algorithm places rects into.
 *
 * `gap` is the spacing between adjacent items along whichever axis
 * the layout stacks items. Not to be confused with `padding`, which
 * is applied by {@link computeCollageLayout} before calling into the
 * layout algorithm.
 */
export interface InnerRegion {
  x: number;
  y: number;
  w: number;
  h: number;
  gap: number;
}
