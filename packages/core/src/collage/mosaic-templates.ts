/**
 * Mosaic templates for photo counts 1..9.
 *
 * Each template is a structural tree of weighted splits:
 *   - `{ type: 'row', children }`  — children placed left-to-right,
 *     full height, widths proportional to child weights.
 *   - `{ type: 'col', children }`  — children placed top-to-bottom,
 *     full width, heights proportional to child weights.
 *   - `{ type: 'leaf', weight }`   — a photo slot.
 *
 * Weights are relative within a parent (so one child can be twice as
 * wide/tall as a sibling). Templates intentionally feature a "hero" cell
 * in many cases. Photos are assigned to leaves by best aspect fit so
 * cropping is minimized, but the overall composition (sizes, hierarchy)
 * is fixed by the template. L = landscape-canvas variant,
 * P = portrait-canvas variant.
 */

export interface MosaicLeaf {
  type: 'leaf';
  weight: number;
}

export interface MosaicSplit {
  type: 'row' | 'col';
  weight: number;
  children: MosaicNode[];
}

export type MosaicNode = MosaicLeaf | MosaicSplit;

export interface MosaicTemplate {
  L: MosaicNode;
  P?: MosaicNode;
}

const Lf = (weight?: number): MosaicLeaf => ({
  type: 'leaf',
  weight: weight ?? 1,
});
const Row = (weight: number, ...c: MosaicNode[]): MosaicSplit => ({
  type: 'row',
  weight,
  children: c,
});
const Col = (weight: number, ...c: MosaicNode[]): MosaicSplit => ({
  type: 'col',
  weight,
  children: c,
});

export const MOSAIC_TEMPLATES: Partial<Record<number, MosaicTemplate>> = {
  1: { L: Lf(1) },
  2: {
    L: Row(1, Lf(1), Lf(1)),
    P: Col(1, Lf(1), Lf(1)),
  },
  // 3: hero on one side, two stacked on the other.
  3: {
    L: Row(1, Lf(2), Col(1, Lf(1), Lf(1))),
    P: Col(1, Lf(2), Row(1, Lf(1), Lf(1))),
  },
  // 4: hero + 3 stacked.
  4: {
    L: Row(1, Lf(2), Col(1, Lf(1), Lf(1), Lf(1))),
    P: Col(1, Lf(2), Row(1, Lf(1), Lf(1), Lf(1))),
  },
  // 5: hero + 4 in a 2x2 grid.
  5: {
    L: Row(1, Lf(2), Col(1, Row(1, Lf(1), Lf(1)), Row(1, Lf(1), Lf(1)))),
    P: Col(1, Lf(2), Col(1, Row(1, Lf(1), Lf(1)), Row(1, Lf(1), Lf(1)))),
  },
  // 6: hero + 5 (top: 2 small, bottom: 3 small).
  6: {
    L: Row(
      1,
      Col(2, Lf(1), Row(1, Lf(1), Lf(1))),
      Col(1, Lf(1), Lf(1), Lf(1)),
    ),
    P: Col(
      1,
      Row(2, Lf(1), Col(1, Lf(1), Lf(1))),
      Row(1, Lf(1), Lf(1), Lf(1)),
    ),
  },
  // 7: hero + 2 stacked + 4 in a row.
  7: {
    L: Col(
      1,
      Row(2, Lf(2), Col(1, Lf(1), Lf(1))),
      Row(1, Lf(1), Lf(1), Lf(1), Lf(1)),
    ),
    P: Row(
      1,
      Col(2, Lf(2), Row(1, Lf(1), Lf(1))),
      Col(1, Lf(1), Lf(1), Lf(1), Lf(1)),
    ),
  },
  // 8: hero + 3 in a column + 4 in a row.
  8: {
    L: Col(
      1,
      Row(2, Lf(2), Col(1, Lf(1), Lf(1), Lf(1))),
      Row(1, Lf(1), Lf(1), Lf(1), Lf(1)),
    ),
    P: Row(
      1,
      Col(2, Lf(2), Row(1, Lf(1), Lf(1), Lf(1))),
      Col(1, Lf(1), Lf(1), Lf(1), Lf(1)),
    ),
  },
  // 9: hero + 8 around it (top row of 4, right column of 2, bottom row of 2).
  9: {
    L: Col(
      1,
      Row(2, Lf(2), Col(1, Lf(1), Lf(1), Lf(1))),
      Row(1, Lf(1), Lf(1), Lf(1), Lf(1), Lf(1)),
    ),
    P: Row(
      1,
      Col(2, Lf(2), Row(1, Lf(1), Lf(1), Lf(1))),
      Col(1, Lf(1), Lf(1), Lf(1), Lf(1), Lf(1)),
    ),
  },
};
