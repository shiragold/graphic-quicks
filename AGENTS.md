# graphic-quicks

A pnpm workspace holding a set of standalone browser mini-apps under `apps/`
(`photo-edit`, `photo-collage`, `image-scale`) plus three per-tool packages containing
the pure graphic-tool functions extracted from them:
`@graphic-quicks/photo-edit` (OpenCV.js deskew/crop helpers),
`@graphic-quicks/collage` (collage layout math + EXIF date parsing), and
`@graphic-quicks/scale` (scale-factor math). The packages have no DOM or
Canvas dependencies and each ships ESM with a single `"."` export → `dist/`.
There is no umbrella package; `@graphic-quicks/core` was dissolved.

## Structure

```
/
  pnpm-workspace.yaml              # globs packages/* and apps/*
  package.json                     # workspace root (private)
  tsconfig.base.json               # shared compilerOptions; packages extend it
  vitest.config.ts                 # projects: packages/* + apps/*/vitest.config.ts
  eslint.config.js
  apps/
    photo-edit/                    # mini-app with its own test suite (in the workspace)
    photo-collage/                 # static photo-collage.html
    image-scale/                   # static index.html
  packages/
    photo-edit/                    # @graphic-quicks/photo-edit
      src/                         # 5 pure OpenCV functions
      tests/                       # unit + pipeline tests, PNG fixtures
        setup.ts                   # awaits opencv-js Promise, sets globalThis.cv
    collage/                       # @graphic-quicks/collage
      src/                         # layout math + EXIF, mosaic-templates.ts
      tests/                       # per-layout tests + EXIF golden
    scale/                         # @graphic-quicks/scale
      src/                         # computeScaledSize
      tests/                       # unit tests
```

Each package carries the same wiring: `package.json`, `tsconfig.json` (editor +
typecheck) and `tsconfig.build.json` (tsc emit → `dist/`), both extending the
root `tsconfig.base.json`, plus a `vitest.config.ts` picked up by the root
projects config.

## Commands

Run from the repo root. Node >= 22, pnpm 10.

```sh
pnpm install
pnpm lint                          # eslint across the repo
pnpm -r typecheck                  # tsc --noEmit in each package + the photo-edit app
pnpm test                          # root vitest projects run — packages + app suites (100 tests)
pnpm -r build                      # tsc emit -> packages/*/dist (.js + .d.ts + maps)
```

Scoped to one package:

```sh
pnpm --filter @graphic-quicks/photo-edit test:watch
pnpm --filter @graphic-quicks/photo-edit fixtures   # regenerate PNG test fixtures
```

The mini-apps are buildless static HTML, but they import the packages'
`dist/` over HTTP, so they cannot be opened via `file://` (ES modules are
CORS-fetched and `file://` is an opaque origin). Run them locally with:

```sh
pnpm -r build   # dist/ is not committed; needed after clone or package changes
pnpm serve      # static server at the repo root
# then open http://localhost:3000/apps/photo-edit/ etc.
```

`apps/photo-edit` is a workspace project (the `apps/*` glob), so its test
suite runs under the root `pnpm test` alongside the packages.

## ADR

### One package per tool, no umbrella

The packages are independent; consumers import exactly the tool they need
(`@graphic-quicks/scale` pulls in no collage code and no OpenCV). Boundaries
between tools are structural — separate packages — rather than enforced by a
lint rule. This is what keeps buildless apps from over-downloading.

### Only pure, framework-agnostic code lives in the packages

Canvas 2D drawing (`drawCover`, `roundedRectPath`, `drawPolaroid`), file
loading, upload UI, and DOM event handlers were deliberately left in the
mini-apps. `image-scale`'s Canvas resampling is likewise not ported — only
`computeScaledSize` and `SUPPORTED_SCALE_FACTORS` are. Layout functions return
positioned rectangles and leave rendering to the caller.

### The mini-apps are not consumers of the packages (yet)

The apps were not modified when the packages were extracted; they still carry
their own copies of the logic.
Changing a shared algorithm therefore requires touching both places, or
migrating the mini-app first — migration is Phase 3 of `TASKS.md`.

### `cv` is an ambient global, not an import

`packages/photo-edit`'s modules declare `declare const cv: CV` and reference
`cv` as a free identifier, matching the original `photo-edit.js` design.
`@techstark/opencv-js` is an **optional** peer dependency. Consumers must set
`globalThis.cv` and await runtime initialization before calling any photo-edit
function — either via a browser `<script>` build or a Node `require`.

### Tests load opencv-js via `createRequire` inside `beforeAll`

Under vitest 4.1.x, `import cv from '@techstark/opencv-js'` with top-level
await crashes with `TypeError: Method Promise.prototype.then called on
incompatible receiver [object Module]`: the CJS entry in opencv-js 5.x
evaluates to a `Promise<CVModule>` rather than a synchronous object, and
vitest's ESM wrapper mishandles that. `packages/photo-edit/tests/setup.ts`
uses `createRequire(import.meta.url)('@techstark/opencv-js')` and awaits the
Promise inside a `beforeAll` hook instead.

### Never use `.roi().clone()` to extract a sub-image

`@techstark/opencv-js`'s `Mat.clone()` does not re-tighten the row stride for a
ROI — it memcpy's `rows*cols*4` contiguous bytes from the ROI origin, so
consecutive ROI rows overlap with the parent's neighbouring pixels. The
pipeline test uses a row-by-row `matToRawImage(mat, rect)` helper instead. This
is test-only; the library itself does not depend on it.

### Mosaic templates are preserved verbatim

`packages/collage/src/mosaic-templates.ts` is a 1:1 copy of the hand-tuned
template tables from the original collage app. Treat it as data, not code to
refactor.
