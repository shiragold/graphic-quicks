# TASKS

Living checklist for the restructure. Update as tasks are delegated, progressed,
and completed.

**Decision resolved 2026-08-29: the `fTASKS.md` plan wins** — per-tool packages,
buildless apps, zero-dep custom elements for shared UI. This file is now the
operational checklist for that plan. `fTASKS.md` and `PLAN-COMPARISON.md` are kept
as historical records; this file supersedes both.

## Decisions (locked)

- Per-tool packages: `@graphic-quicks/photo-edit`, `@graphic-quicks/collage`,
  `@graphic-quicks/scale`. `@graphic-quicks/core` dissolves — no umbrella package.
- Shared infra at root: `tsconfig.base.json`, single root vitest projects config,
  `workspace:*` inter-package deps. No changesets/versioning until packages are
  actually published to npm.
- UI component packages (`ui-*`) are plain custom elements, zero dependencies,
  full UI (markup + styles). First one: `ui-photo-upload`.
- Repo layout: `apps/` (photo-edit, photo-collage, image-scale, studio) +
  `packages/`. `apps/*` is already in `pnpm-workspace.yaml` (Phase 0).
- Mini-apps stay buildless: `<script type="module">` importing
  `../../packages/<tool>/dist/index.js`. `dist/` is NOT committed; run
  `pnpm -r build` after clone / package changes.
- **Acknowledged trade-off:** once apps import from `dist/`, `file://` opening
  stops working (ES modules + opaque origin). Apps require a local HTTP server
  and a prior build. A root `serve` script and docs cover this (task 3.0).
- Shipping: static host (GitHub Pages). Deploy workflow builds packages and
  publishes `apps/` + `packages/*/dist`. Apps themselves get no build step.
- Studio: Vite + vanilla TS launcher using the custom elements. Deferred.
- Tests: vitest everywhere, run against TS source.

## Phase 0 — Guardrails ✅ done

- [x] ESLint `import-x/no-restricted-paths` enforcing tool boundaries in `core`.
      Becomes structurally redundant after Phase 1; removed in task 1.6.
- [x] `apps/*` added to `pnpm-workspace.yaml`.
- [x] Root `lint` script; `lint`, `typecheck`, `test` wired into
      `.github/workflows/ci.yml`.

## Phase 1 — Split core into per-tool packages

Mechanical, guarded by the 88 existing tests. No user-visible change. Baseline
before starting: `pnpm lint && pnpm -r typecheck && pnpm -r test && pnpm -r build`
all green, 88 tests.

- [x] **1.1 Root shared infra.** Create `tsconfig.base.json` (lift compilerOptions
      from `packages/core/tsconfig.json`); make `core` extend it as a no-op
      refactor. Add root `vitest.config.ts` with `projects: ['packages/*']`; point
      the root `test` script at it.
      *Verify:* `pnpm -r typecheck` green; a single `vitest run` from root runs
      all 88 core tests.
- [x] **1.2 `packages/scale`** (smallest, no OpenCV — proves the package shape).
      Move `core/src/scale` → `packages/scale/src`, `core/tests/scale` →
      `packages/scale/tests`. `package.json` with `.` export → `dist/index.js`,
      build/test/typecheck scripts, tsconfigs extending base. Keep `core`'s
      `scale` re-export pointing at the new package (`workspace:*`) until 1.5,
      or delete the core copy now — either way no duplicate source.
      *Verify:* `pnpm --filter @graphic-quicks/scale typecheck && test && build`;
      scale tests pass; `dist/` emitted with `.js` + `.d.ts` + maps.
- [x] **1.3 `packages/collage`.** Same recipe: `core/src/collage` + its 7 test
      files. `mosaic-templates.ts` moves verbatim (ADR: data, not code).
      *Verify:* per-package typecheck/test/build green.
- [x] **1.4 `packages/photo-edit`.** Move `core/src/photo-edit`, its tests,
      `tests/setup.ts` (createRequire opencv loader), `fixtures.ts` +
      `generate-fixtures.ts` + PNG fixtures, and the `fixtures` script.
      `@techstark/opencv-js` optional peer dep lives here only; `pngjs`/`tsx`
      dev deps come along. Per-package vitest config keeps `setupFiles` +
      30s timeouts.
      *Verify:* per-package typecheck/test/build green; opencv loads in
      `beforeAll`; `pnpm --filter @graphic-quicks/photo-edit fixtures` still
      regenerates fixtures.
- [x] **1.5 Delete `packages/core`.** Remove the directory, its lockfile entries
      (`pnpm install`), and any lingering references.
      *Verify:* `rg "@graphic-quicks/core"` finds nothing outside docs;
      `pnpm -r build` green.
- [x] **1.6 Remove the ESLint boundary rule.** The three-zone
      `import-x/no-restricted-paths` config in `eslint.config.js` is now enforced
      structurally by the package split. Simplify the config; keep ESLint itself.
      *Verify:* `pnpm lint` green.
- [x] **1.7 Update `AGENTS.md`** — structure tree, commands, ADRs ("public API is
      namespaced" ADR is retired; opencv/setup/roi-clone ADRs move under
      photo-edit's context).
      *Verify:* every command listed in AGENTS.md actually runs.
- [x] **1.8 Full gate:** `pnpm lint && pnpm -r typecheck && pnpm -r test &&
      pnpm -r build` — same 88 tests passing, dist emitted per package. Commit
      point.

## Phase 2 — apps/ layout

Pure moves; apps keep their duplicated logic for now.

- [x] **2.1 `photo-edit/` → `apps/photo-edit/`.** Delete its `package-lock.json`
      and fold deps into pnpm (`pnpm install` from root now covers it — it joins
      the workspace via the `apps/*` glob). Hook its vitest config into the root
      projects config.
      *Verify:* `pnpm -r test` from root now includes its suite (record new total
      test count as the baseline going forward); `apps/photo-edit/index.html`
      still works served locally.
- [x] **2.2 `photo-collage/` → `apps/photo-collage/`.** Static move, no deps.
      *Verify:* page opens and renders all 7 layouts.
- [x] **2.3 `image-scale.html` → `apps/image-scale/index.html`.** Static move.
      *Verify:* page opens, scales an image.
- [x] **2.4 Update CI paths / AGENTS.md** for the new layout.
      *Verify:* CI green on the branch.

## Phase 3 — Migrate mini-apps onto packages (one at a time)

- [x] **3.0 Dev-serve story.** Root `serve` script (any static server) + README/
      AGENTS.md note: `pnpm -r build` then `pnpm serve`, open
      `localhost:.../apps/<app>/`. Needed because `dist/` imports kill `file://`.
      *Verify:* fresh-clone dry run: install → build → serve → all three apps load.
- [x] **3.1 image-scale → `@graphic-quicks/scale`** (smallest first). Replace the
      inlined math with an import of `../../packages/scale/dist/index.js`; keep
      canvas resampling in the app.
      **Decision point before starting:** the app has four known bugs (see
      Findings below — dead JSZip "Download All", mid-run factor change, XSS via
      filename, no canvas-size ceiling). Fix during migration, or port as-is and
      fix separately? Also: core `computeScaledSize` throws `RangeError` on
      zero/non-finite dimensions where the app silently blanked — the app must
      catch and surface this.
      *Verify:* scaled output byte-identical to the old page for a sample image;
      DevTools network shows only the scale package fetched (no collage, no
      OpenCV).
- [x] **3.2 photo-collage → `@graphic-quicks/collage`.** Replace inlined layout
      math + EXIF parsing (the 7 layout functions and `readExifDate` are already
      in the package, tested); keep rendering (`render`, `drawPolaroid`) in the
      app.
      *Verify:* each of the 7 layouts renders identically to the old page
      (screenshot diff); EXIF-date sorting unchanged on a sample set.
- [x] **3.3 photo-edit app → `@graphic-quicks/photo-edit`.** Replace
      `photo-edit.js` logic with package imports; keep canvas/DOM/upload code.
      First diff `apps/photo-edit/tests/` against the package's tests and fold in
      any coverage the package lacks; then delete `photo-edit.js` + `.d.ts` and
      the app's now-duplicate tests.
      *Verify:* deskew + crop output matches on the PNG fixtures; no test-count
      regression vs the Phase 2.1 baseline; manual smoke of the full pipeline in
      the browser.
- [x] **3.4 Retire the "mini-apps are not consumers of core" ADR** in AGENTS.md;
      document the new rule: shared algorithms live only in packages.
      *Verify:* `rg` finds no duplicated algorithm code left in `apps/`.

## Phase 4 — First UI package

- [x] **4.1 Inventory upload UI** across the three apps (dropzone, file input,
      thumbnail tray) and specify the custom element's attributes/events.
- [x] **4.2 `packages/ui-photo-upload`:** zero-dep custom element, markup +
      styles included, built with the same tsconfig.base/vitest wiring.
      *Verify:* unit tests for the element's public contract (events fired,
      attributes reflected) under happy-dom/jsdom.
- [x] **4.3 Adopt in the apps,** one app per task, deleting each app's bespoke
      upload code.
      *Verify per app:* upload flow works served locally; no regression in the
      app's tests.

## Phase 5 — Deploy

- [ ] **5.1 Replace the Jekyll workflow** (`.github/workflows/deploy.yml`) with:
      pnpm install → `pnpm -r build` → upload `apps/` + `packages/*/dist` as the
      Pages artifact (preserving the relative `../../packages/...` paths).
      *Verify:* artifact structure locally mirrors the repo layout the imports
      expect.
- [ ] **5.2 Ship it.** Decide URL layout (subpath per app).
      *Verify:* all three apps load from their published GitHub Pages URLs.

## Phase 6 — Studio (later)

- [ ] Scaffold `apps/studio` (Vite, vanilla TS) as a launcher using the custom
      elements. Shape unknown — "start as launcher, evolve".

## Findings from the scale port spec (plan-independent)

Bugs in `image-scale.html`, relevant to task 3.1:

- **"Download All" has never worked** — `new JSZip()` with JSZip loaded nowhere;
  every click throws and is swallowed.
- **Factor change mid-run** — the running loop captured `scale` up front and
  finishes at the old factor while stamping items complete.
- **XSS via filename** — `alt`/`title` interpolated into `innerHTML` unescaped.
- **No canvas-size ceiling** — 8× on a large photo silently blanks the canvas
  and is still marked complete.
- Core `computeScaledSize` throws `RangeError` on zero/non-finite dims where the
  app silently produced a blank (reachable via dimensionless SVG).

## Deferred / revisit when relevant

- npm publishing + versioning strategy (changesets) — when publishing becomes real.
- Framework for studio — only if the launcher outgrows custom elements.
- Import maps in apps — if relative dist paths get unwieldy or CDN swap wanted.
- Collage state management: the port keeps ~1498 lines of imperative DOM sync
  inside custom-element boundaries. If it proves unmaintainable, revisit a
  framework for that app only (custom elements remain consumable either way).
