# TASKS — restructure into per-tool packages + apps

Plan agreed 2026-07-26. Goal: one big app (studio) + small lean buildless
mini-apps, backed by narrow, replaceable per-tool packages.

## Decisions (locked)

- Per-tool packages: `@graphic-quicks/photo-edit`, `@graphic-quicks/collage`,
  `@graphic-quicks/scale`. `@graphic-quicks/core` dissolves — no umbrella
  meta-package.
- Shared infra at root: `tsconfig.base.json`, single root vitest projects
  config, `workspace:*` inter-package deps. No changesets/versioning until
  packages are actually published to npm (deferred, "maybe later").
- UI component packages (`ui-*`) are plain custom elements, zero dependencies,
  full UI (markup + styles). First one: `ui-photo-upload`.
- Repo layout: `apps/` (photo-edit, photo-collage, image-scale, studio) +
  `packages/`. Apps join the pnpm workspace (`apps/*` in pnpm-workspace.yaml).
- Mini-apps stay buildless: `<script type="module">` importing
  `../../packages/<tool>/dist/index.js` (relative, no import map for now).
  `dist/` is NOT committed; run `pnpm -r build` after clone / package changes.
- Shipping: static host (GitHub Pages). Deploy workflow builds packages and
  publishes `apps/` + `packages/*/dist`. Apps themselves get no build step.
- Studio: Vite + vanilla TS launcher using the custom elements. Shape unknown
  ("start as launcher, evolve") — no framework until proven necessary.
- Tests: vitest everywhere, run against TS source. Buildless apps keep their
  own suites (photo-edit already has one).

## Phases

### Phase 1 — split core into per-tool packages
- [ ] Create `tsconfig.base.json` at root; root vitest projects config
- [ ] `packages/photo-edit` from `packages/core/src/photo-edit` (+ its tests,
      opencv setup.ts, fixtures + generate-fixtures script; opencv-js optional
      peer dep stays here only)
- [ ] `packages/collage` from `packages/core/src/collage` (+ tests)
- [ ] `packages/scale` from `packages/core/src/scale` (+ tests)
- [ ] Delete `packages/core`
- [ ] Update AGENTS.md (structure, commands, ADRs)
- [ ] Verify: `pnpm -r typecheck && pnpm -r test && pnpm -r build` — same 88
      tests passing, dist emitted per package

### Phase 2 — apps/ layout
- [ ] Move `photo-edit/` → `apps/photo-edit/`, `photo-collage/` →
      `apps/photo-collage/`, `image-scale.html` → `apps/image-scale/index.html`
- [ ] Add `apps/*` to pnpm-workspace.yaml; fold photo-edit's npm deps into
      pnpm; `pnpm -r test` now includes its suite
- [ ] Verify: apps still open/serve correctly; all tests green

### Phase 3 — migrate mini-apps onto packages (one at a time)
- [ ] photo-edit: replace `photo-edit.js` logic with imports from
      `@graphic-quicks/photo-edit` dist; keep app-side canvas/DOM code; tests +
      manual smoke
- [ ] photo-collage: same against `@graphic-quicks/collage`
- [ ] image-scale: same against `@graphic-quicks/scale`
- [ ] Retire "mini-apps are not consumers of core" ADR in AGENTS.md

### Phase 4 — first UI package
- [ ] Extract shared upload UI into `packages/ui-photo-upload` (custom
      element, zero deps) and adopt it in the apps

### Phase 5 — deploy
- [ ] GitHub Pages workflow: `pnpm -r build`, publish `apps/` +
      `packages/*/dist`

### Phase 6 — studio (later)
- [ ] Scaffold `apps/studio` (Vite, vanilla TS) as a launcher for the tools

## Deferred / revisit when relevant
- npm publishing + versioning strategy (changesets) — when publishing becomes
  real
- Framework for studio — only if the launcher outgrows custom elements
- Import maps in apps — if relative dist paths get unwieldy or CDN swap wanted
