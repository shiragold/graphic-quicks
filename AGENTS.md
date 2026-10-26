# graphic-quicks

A pnpm workspace holding a set of standalone browser mini-apps under `apps/`
(`photo-edit`, `photo-collage`, `image-scale`) plus three per-tool packages containing
the pure graphic-tool functions extracted from them:
`@graphic-quicks/photo-edit` (OpenCV.js deskew/crop helpers),
`@graphic-quicks/collage` (collage layout math + EXIF date parsing), and
`@graphic-quicks/scale` (scale-factor math). The packages have no DOM or
Canvas dependencies and each ships ESM with a single `"."` export → `dist/`.
There is no umbrella package; `@graphic-quicks/core` was dissolved.

`@graphic-quicks/photo-filter` is the Node-only exception: it reads the macOS
Photos library (via osxphotos) and ships a library, a `photo-filter` CLI, and a
`photo-filter-mcp` MCP server so agents can browse, view, and export photos.

## Structure

```
/
  pnpm-workspace.yaml              # globs packages/* and apps/*
  package.json                     # workspace root (private)
  tsconfig.base.json               # shared compilerOptions; packages extend it
  vitest.config.ts                 # projects: packages/*
  eslint.config.js
  apps/
    photo-edit/                    # static index.html; private workspace package
    photo-collage/                 # static photo-collage.html; private workspace package
    image-scale/                   # static index.html; private workspace package
  packages/
    photo-edit/                    # @graphic-quicks/photo-edit
      src/                         # pure OpenCV helpers + padded-rect crop math
      tests/                       # unit + pipeline tests, PNG fixtures
        setup.ts                   # awaits opencv-js Promise, sets globalThis.cv
    collage/                       # @graphic-quicks/collage
      src/                         # layout math + EXIF, mosaic-templates.ts
      tests/                       # per-layout tests + EXIF golden
    scale/                         # @graphic-quicks/scale
      src/                         # computeScaledSize + canvas-limit validation
      tests/                       # unit tests
    ui-photo-upload/               # @graphic-quicks/ui-photo-upload
      src/                         # <photo-upload> custom element
      tests/                       # element contract tests (happy-dom)
    photo-filter/                  # @graphic-quicks/photo-filter (Node, macOS)
      src/                         # osxphotos wrapper, cli.ts, mcp.ts + server.ts
        curate/                    # deterministic curate pipeline + model adapter
      tests/                       # fake runner/model/images; MCP in-memory tests
  .cursor/
    mcp.json                       # registers photo-filter-mcp for Cursor
    skills/select-best-photos/     # agent workflow on top of the MCP tools
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
pnpm -r typecheck                  # tsc --noEmit in each package (apps have no typecheck script)
pnpm test                          # package suites only (161 tests)
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

All three apps are private workspace packages (`apps/*/package.json`) with no
build, test, or typecheck scripts. `pnpm -r build` and `pnpm -r typecheck`
therefore run only in `packages/*`. Tests live with the packages; root
`pnpm test` does not run an app suite.

`pnpm serve` can open every app. GitHub Pages publishes the collage app only
(`.github/workflows/deploy.yml` builds `@graphic-quicks/collage` and
`@graphic-quicks/ui-photo-upload`, then uploads those dists plus
`apps/photo-collage`). A combined studio shell is not part of this repo.

## ADR

### One package per tool, no umbrella

The packages are independent; consumers import exactly the tool they need
(`@graphic-quicks/scale` pulls in no collage code and no OpenCV). Boundaries
between tools are structural — separate packages — rather than enforced by a
lint rule. This is what keeps buildless apps from over-downloading.

### Only pure, framework-agnostic code lives in the packages

Packages are not required to run in the browser — `photo-filter` is
Node-only — but they stay free of app UI. The tool packages the apps import
remain DOM- and Canvas-free; shared UI goes in `ui-*` packages.

Canvas 2D drawing (`drawCover`, `roundedRectPath`, `drawPolaroid`), file
loading, upload UI, and DOM event handlers were deliberately left in the
mini-apps. `image-scale`'s Canvas resampling is likewise not ported — the
package ships `computeScaledSize`, `SUPPORTED_SCALE_FACTORS`, and the pure
canvas-limit validation (`assertWithinCanvasLimits`, `MAX_CANVAS_DIMENSION`,
`MAX_CANVAS_AREA`); the `drawImage` call stays in the app. Layout functions
return positioned rectangles and leave rendering to the caller.

### The apps are consumers of the packages

Shared algorithms live only in `packages/`. Each app imports its tool's built
module over a relative path (`../../packages/<tool>/dist/index.js`) from a
`<script type="module">` — no bundler. Changing an algorithm means changing
the package (and its tests); apps carry only canvas/DOM/upload code.

### UI packages are zero-dep custom elements

Shared UI lives in `ui-*` packages (first: `ui-photo-upload`) as plain custom
elements with zero runtime dependencies. Each element ships its full UI —
markup and styles — inside shadow DOM so app CSS cannot break it, and exposes
customization through slots, reflected attributes, and CSS custom properties.
Elements communicate outward only via composed, bubbling `CustomEvent`s (e.g.
`photo-upload:files` with `detail: { files: File[] }`), which keeps them
consumable from buildless apps today and forward-compatible with any future
framework, which can wrap the element or listen to its events natively.
`src/index.ts` registers the element with an idempotent
`customElements.define` guard, so apps import the built module purely for the
side effect. Element tests run under happy-dom (per-package
`test.environment`).

### `cv` is an ambient global, not an import

`packages/photo-edit`'s modules declare `declare const cv: CV` and reference
`cv` as a free identifier, matching the original `photo-edit.js` design.
`@techstark/opencv-js` 5.x is an **optional** peer dependency. Consumers must set
`globalThis.cv` and await runtime initialization before calling any photo-edit
function. The photo-edit app loads that same package from its own
`node_modules` (a classic script whose factory Promise resolves to `cv`). Tests
`require` the package under Node. Do not swap in the docs.opencv.org 4.x build.

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

### photo-filter: one core, CLI and MCP on top, osxphotos underneath

`createPhotoLibrary()` is the single core; `cli.ts` and `server.ts` (MCP
tools `list_albums`, `query_photos`, `get_thumbnails`, `export_photos`) are
thin adapters over it. A future HTTP `serve` mode for the browser apps should
be a third adapter, not a second implementation.

Reads go through the osxphotos CLI (spawned as `PHOTO_FILTER_OSXPHOTOS`,
default `osxphotos`; `.cursor/mcp.json` uses `uvx --python 3.12 osxphotos`
because macOS's Python 3.9 is too old). It reads the Photos SQLite DB
directly, so the host process needs Full Disk Access. The package never
writes to the library — only export copies files out. Thumbnails are the
largest Photos-generated derivative resized with `sips`, returned to agents
as MCP image content so they can judge photos visually.

All process spawning goes through an injectable `CommandRunner`; tests use
`tests/fake-runner.ts`, so the suite runs on Linux CI without osxphotos.

### photo-filter `curate`: code orchestrates, Jev only judges

`photo-filter curate` (`src/curate/`) is a fixed pipeline: one library
query, events split by time gap, a per-photo decision call (subject /
special-moment / quality), near-duplicate knockout via dHash + Jev choice,
then a code-built event spread (~20 picks per 30 days of the range, override
with `--count`) filled by Jev comparing each event's top candidates. Code
owns all control flow; answers are typed probabilities (noul / choice /
score), not free text. Special moments include parents, places, presents,
and celebrations/performances (school shows, holidays, birthdays).

The model sits behind `DecisionModel` (OpenRouter Decisions API, default
`typesafe/jev-1.14`, `OPENROUTER_API_KEY`, override `PHOTO_FILTER_DECISION_MODEL`
or `--model`); images go through `ImageTools` (sharp) and are resized to
Jev's 320–1568 px side limits. Both are injectable, so
`tests/decision-pipeline.test.ts` and related suites run with fakes. The
older Anthropic `VisionModel` path (`pipeline.ts`, `anthropic.ts`) remains
in the package but is not used by the CLI.

`CurationContext` (default `~/.photo-filter/context/<album>--<brief>.json`)
caches decision verdicts keyed by uuid + `model.id` +
`DECISION_PROMPT_VERSION`; prior picks and review feedback steer later
runs. Bump `DECISION_PROMPT_VERSION` whenever questions or scoring change.

The `select-best-photos` skill prefers `curate` for whole requests and
falls back to the MCP tools for interactive browsing.
