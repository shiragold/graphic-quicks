import type {
  CollagePlacement,
  CollageSettings,
  InnerRegion,
} from './types.js';
import { justifiedRows, justifiedCols } from './layouts/justified.js';
import { grid } from './layouts/grid.js';
import { masonry } from './layouts/masonry.js';
import { heroGrid } from './layouts/hero-grid.js';
import { mosaic } from './layouts/mosaic.js';
import { polaroid } from './layouts/polaroid.js';
import { singleRow, singleColumn } from './layouts/row-column.js';

/**
 * Compute a collage placement for each aspect ratio in `aspects` under
 * the given settings. Returned array is indexed by input position;
 * slots may be `undefined` for layouts that don't produce a placement
 * for every index (e.g. mosaic outside the 1..9 range).
 *
 * The layout algorithms are pure math — no DOM, no canvas. The caller
 * pre-computes each photo's aspect ratio (width / height) and later
 * uses the returned rects / polaroid placements to actually paint.
 */
export function computeCollageLayout(
  aspects: readonly number[],
  settings: CollageSettings,
): Array<CollagePlacement | undefined> {
  const n = aspects.length;
  if (n === 0) return [];

  const gap = settings.gap ?? 0;
  const padding = settings.padding ?? 0;
  const columns = settings.columns ?? 2;
  const heroPos = settings.heroPos ?? 'center';
  const polaroidSeed = settings.polaroidSeed ?? 0;

  const region: InnerRegion = {
    x: padding,
    y: padding,
    w: settings.width - 2 * padding,
    h: settings.height - 2 * padding,
    gap,
  };

  switch (settings.layout) {
    case 'justified-rows':
      return justifiedRows(aspects, region);
    case 'justified-cols':
      return justifiedCols(aspects, region);
    case 'row':
      return singleRow(n, region);
    case 'column':
      return singleColumn(n, region);
    case 'grid':
      return grid(aspects, region, columns);
    case 'columns':
      return masonry(aspects, region, columns);
    case 'hero-grid':
      return heroGrid(aspects, region, heroPos);
    case 'mosaic':
      return mosaic(aspects, region);
    case 'polaroid':
      return polaroid(aspects, region, polaroidSeed);
  }
}
