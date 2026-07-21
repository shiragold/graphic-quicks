# Tasks

Living checklist for current work. Update as tasks progress.

## graphic-quicks: pnpm workspace with `@graphic-quicks/core` package ✅

Goal: extract framework-agnostic, pure graphic-tool functions from the existing
`photo-collage`, `image-scale`, and `photo-edit` sub-projects into a single
reusable TypeScript package. The originals are untouched.

### Scope of extraction

- **photo-edit** (OpenCV.js pure functions):
  `sampleBackgroundColor`, `detectSkewAngle`, `rotateImage`, `detectPhotoBBox`,
  `processMat`. All operate on `cv.Mat`. Ported to TypeScript one function
  per file, with the `cv` singleton resolved as an ambient global
  (`declare const cv: CV`) so consumers can supply either a browser `<script>`
  build or a Node `require('@techstark/opencv-js')` await.
- **photo-collage** (pure math + EXIF, no Canvas/DOM):
  `readExifDate(Uint8Array)` extracted from the JPEG scanner,
  `computeCollageLayout(aspects, settings)` covering `justified-rows`,
  `justified-cols`, `grid`, `columns` (masonry), `hero-grid`, `mosaic`,
  `polaroid`, `row`, `column`. Each layout is also re-exported for direct
  use. Mosaic templates preserved 1:1 in `mosaic-templates.ts`.
- **image-scale** (pure math only): `computeScaledSize` +
  `SUPPORTED_SCALE_FACTORS`. The source's Canvas drawing is not reusable
  outside the browser and was intentionally not ported.

Explicitly **not** extracted (browser-specific): Canvas 2D drawing
(`drawCover`, `roundedRectPath`, `drawPolaroid`), file loading, upload UI,
DOM event handlers.

### Structure

```
/
  pnpm-workspace.yaml
  package.json                     # workspace root (private)
  packages/core/
    package.json                   # @graphic-quicks/core
    tsconfig.json                  # editor + typecheck
    tsconfig.build.json            # tsc emit -> dist/
    vitest.config.ts
    tests/setup.ts                 # awaits opencv-js Promise, sets globalThis.cv
    src/
      index.ts                     # barrel of namespaces: photoEdit, collage, scale
      photo-edit/                  # 5 pure OpenCV functions
      collage/                     # layout math + EXIF
      scale/                       # computeScaledSize
    tests/
      photo-edit/                  # unit + pipeline tests
      collage/                     # per-layout tests + EXIF golden
      scale/                       # unit tests
```

### Steps

- [x] Rewrite TASKS.md
- [x] pnpm workspace root: `pnpm-workspace.yaml`, root `package.json`, `.gitignore`
- [x] `packages/core` skeleton: `package.json` (`@graphic-quicks/core`,
      ESM, `tsc` build to `dist/`), `tsconfig.json`, `tsconfig.build.json`,
      `vitest.config.ts`, `README.md`
- [x] Port photo-edit functions to `src/photo-edit/*.ts`
- [x] Port photo-collage layout math to `src/collage/*.ts` as pure functions
      taking an aspects array + settings
- [x] Port EXIF reader to `src/collage/exif.ts` accepting `Uint8Array`
- [x] Add `src/scale/compute-scaled-size.ts`
- [x] Barrel `src/index.ts` re-exports (as `photoEdit`, `collage`, `scale`
      namespaces so subpath-imports remain the primary API)
- [x] Tests: port photo-edit tests, add collage layout tests, EXIF tests,
      scale tests
- [x] `pnpm install` clean
- [x] `pnpm -r typecheck` green
- [x] `pnpm -r test` green (88 tests)
- [x] `pnpm -r build` produces `dist/` with `.js` + `.d.ts` + source maps

### Notable adjustments made during porting

- **Vitest 4.x + opencv-js**. The original `photo-edit/tests/setup.ts` uses
  top-level `await` and `import cv from '@techstark/opencv-js'`. Under
  vitest 4.1.x this crashes with `TypeError: Method Promise.prototype.then
  called on incompatible receiver [object Module]` because the CJS module's
  entry (in opencv-js 5.x) evaluates to a `Promise<CVModule>`, not a
  synchronous object, and vitest's ESM wrapper mishandles that. Fixed by
  using `createRequire(import.meta.url)('@techstark/opencv-js')` inside a
  `beforeAll` hook and awaiting the Promise.
- **`cv` as ambient global**. Source modules use `declare const cv: CV` and
  reference `cv` as a free identifier (matching the original photo-edit.js
  design). Consumers must set `globalThis.cv` before calling any function.
- **`.roi().clone()` quirk**. `@techstark/opencv-js`'s `Mat.clone()` does
  NOT re-tighten the row stride for a ROI — it memcpy's `rows*cols*4`
  contiguous bytes from the ROI origin, so consecutive ROI rows overlap
  with the parent's neighboring pixels. The pipeline test now uses
  `matToRawImage(mat, rect)` (row-by-row copy) instead of `.roi().clone()`.
  This is a test-only helper; the library itself doesn't depend on it.

### Kept untouched

- `photo-edit/` (existing untracked folder), `photo-collage/`, `image-scale.html`
  — none of them modified.
