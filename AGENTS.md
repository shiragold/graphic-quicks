# graphic-quicks

A pnpm workspace holding a set of standalone browser mini-apps (`photo-edit/`,
`photo-collage/`, `image-scale.html`) plus `@graphic-quicks/core` — a
framework-agnostic TypeScript package containing the pure graphic-tool
functions extracted from them: OpenCV.js deskew/crop helpers, collage layout
math, EXIF date parsing, and scale-factor math. The core package has no DOM or
Canvas dependencies and ships ESM with per-module subpath exports.

## Structure

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

## Commands

Run from the repo root. Node >= 22, pnpm 10.

```sh
pnpm install
pnpm -r typecheck                  # tsc --noEmit across the workspace
pnpm -r test                       # vitest run (88 tests)
pnpm -r build                      # tsc emit -> packages/core/dist (.js + .d.ts + maps)
```

Scoped to the core package:

```sh
pnpm --filter @graphic-quicks/core test:watch
pnpm --filter @graphic-quicks/core fixtures   # regenerate photo-edit PNG test fixtures
```

The mini-apps are static HTML — open `photo-edit/index.html`,
`photo-collage/photo-collage.html`, or `image-scale.html` directly in a
browser; no build step is involved. `photo-edit/` is *not* part of the pnpm
workspace (`pnpm-workspace.yaml` only globs `packages/*`) but has its own
`package.json` and test suite, so `pnpm -r ...` from the root skips it:

```sh
cd photo-edit && pnpm install && pnpm test
```

## ADR

### Only pure, framework-agnostic code lives in core

Canvas 2D drawing (`drawCover`, `roundedRectPath`, `drawPolaroid`), file
loading, upload UI, and DOM event handlers were deliberately left in the
mini-apps. `image-scale`'s Canvas resampling is likewise not ported — only
`computeScaledSize` and `SUPPORTED_SCALE_FACTORS` are. Layout functions return
positioned rectangles and leave rendering to the caller.

### The mini-apps are not consumers of core

`photo-edit/`, `photo-collage/`, and `image-scale.html` were not modified when
core was extracted; they still carry their own copies of the logic. Core is
additive. Changing a shared algorithm therefore requires touching both places,
or migrating the mini-app first.

### `cv` is an ambient global, not an import

Core's photo-edit modules declare `declare const cv: CV` and reference `cv` as
a free identifier, matching the original `photo-edit.js` design.
`@techstark/opencv-js` is an **optional** peer dependency. Consumers must set
`globalThis.cv` and await runtime initialization before calling any photo-edit
function — either via a browser `<script>` build or a Node `require`.

### Tests load opencv-js via `createRequire` inside `beforeAll`

Under vitest 4.1.x, `import cv from '@techstark/opencv-js'` with top-level
await crashes with `TypeError: Method Promise.prototype.then called on
incompatible receiver [object Module]`: the CJS entry in opencv-js 5.x
evaluates to a `Promise<CVModule>` rather than a synchronous object, and
vitest's ESM wrapper mishandles that. `tests/setup.ts` uses
`createRequire(import.meta.url)('@techstark/opencv-js')` and awaits the
Promise inside a `beforeAll` hook instead.

### Never use `.roi().clone()` to extract a sub-image

`@techstark/opencv-js`'s `Mat.clone()` does not re-tighten the row stride for a
ROI — it memcpy's `rows*cols*4` contiguous bytes from the ROI origin, so
consecutive ROI rows overlap with the parent's neighbouring pixels. The
pipeline test uses a row-by-row `matToRawImage(mat, rect)` helper instead. This
is test-only; the library itself does not depend on it.

### The public API is namespaced, with subpath imports as the primary route

`src/index.ts` re-exports `photoEdit`, `collage`, and `scale` namespaces, while
`./photo-edit`, `./collage`, and `./scale` subpath exports let consumers pull in
one module without dragging in the others (notably, avoiding OpenCV when only
layout math is needed).

### Mosaic templates are preserved verbatim

`collage/mosaic-templates.ts` is a 1:1 copy of the hand-tuned template tables
from the original collage app. Treat it as data, not code to refactor.
