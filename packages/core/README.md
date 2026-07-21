# @graphic-quicks/core

Framework-agnostic pure graphic-tool functions used across the
[graphic-quicks](../../README.md) mini-apps. Each subpath export is
independent, so consumers only pay for what they use.

## Modules

### `@graphic-quicks/core/photo-edit`

OpenCV.js helpers for automatically deskewing and cropping scanned photos.
Ported from `photo-edit/photo-edit.js`.

- `sampleBackgroundColor(src)` — median RGB from the four corners.
- `detectSkewAngle(src)` — Hough-lines skew detection in ±45°.
- `rotateImage(src, dst, angleDeg, bgColor)` — expand-canvas rotation
  that fills the padding with the sampled background color.
- `detectPhotoBBox(src, bgColor)` — largest connected foreground region.
- `processMat(src)` — orchestrator: sample bg, detect skew, rotate,
  detect bbox on both original and rotated frames, return the working
  Mat + margins.

All functions rely on the `cv` singleton from
[`@techstark/opencv-js`](https://www.npmjs.com/package/@techstark/opencv-js),
which is declared as an **optional** peer dependency. Callers are
responsible for awaiting `cv.onRuntimeInitialized` before invoking any
of these functions.

### `@graphic-quicks/core/collage`

Pure layout math ported from `photo-collage/photo-collage.html`. Takes
an array of aspect ratios + settings, returns positioned rectangles.
No Canvas / DOM code — the calling framework handles rendering.

- `computeCollageLayout(aspects, settings)` — dispatches to the
  appropriate layout algorithm.
- `readExifDate(bytes)` — parses `DateTimeOriginal` (0x9003) from a
  JPEG buffer (`Uint8Array`). Returns a `Date` or `null`.
- Individual layout algorithms are also re-exported for finer control:
  `justifiedRows`, `justifiedCols`, `grid`, `masonry`, `heroGrid`,
  `mosaic`, `polaroid`, `singleRow`, `singleColumn`.

### `@graphic-quicks/core/scale`

- `computeScaledSize(size, factor)` — target `{ width, height }` for
  a given integer scale factor. Pure math, no Canvas required.

## Development

```sh
pnpm install
pnpm --filter @graphic-quicks/core test
pnpm --filter @graphic-quicks/core build
```
