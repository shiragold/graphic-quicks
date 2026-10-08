# Plan comparison — `TASKS.md` vs `fTASKS.md`

Two restructure plans exist, produced in parallel sessions on 2026-07-26. Both aim
at the same goal: one rich app (`studio`) plus small lean standalone apps, backed by
narrow replaceable packages. They disagree on how to get there. This document exists
to make the choice, not to advocate for either.

## The one decision that drives all the others

**Buildless or bundled?** Everything else in both plans follows from this, and the
two plans are each internally consistent once you accept their answer.

If apps are **buildless**, there is no bundler, so nothing tree-shakes and nothing
code-splits. Package granularity *becomes* delivery granularity — the only way an app
avoids downloading the collage code is for collage to be a separate package it doesn't
import. That is precisely why `fTASKS.md` dissolves `core` into three packages. The
split isn't cosmetic there; it's load-bearing.

If apps are **bundled**, the bundler handles splitting and tree-shaking, so package
granularity has no effect on what ships. `core`'s existing `./photo-edit`, `./collage`,
and `./scale` subpath exports already give per-tool dynamic imports. That is why
`TASKS.md` leaves `core` intact — under Vite the split buys nothing you don't have.

So: decide buildless vs bundled first. The packaging question answers itself.

## Side by side

| | `TASKS.md` | `fTASKS.md` |
|---|---|---|
| Apps | Vue 3 + Vite | Buildless `<script type="module">` |
| `core` | One package, subpath exports | Dissolved into 3 per-tool packages |
| Boundary enforcement | ESLint `import-x/no-restricted-paths` | Structural (separate packages) |
| Shared UI | Vue SFC package | Zero-dep custom elements |
| Studio | Vue, lazy route per tool | Vite + vanilla TS launcher |
| First deliverable | Working Vue scale app (Phase 1) | Split packages, no user-visible change (Phase 1) |
| Shared infra | Per-package configs | `tsconfig.base.json` + root vitest projects |
| Deploy | Vite build per app | `pnpm -r build`, publish `apps/` + `packages/*/dist` |

## Dimension by dimension

### Config overhead

My original objection to splitting `core` was the per-package config tax — four config
files each over ~330 lines of source. **`fTASKS.md` largely defuses this** with a root
`tsconfig.base.json` and a single root vitest projects config, leaving each package
with little more than a `package.json`. Credit where due: this is a weaker argument
against splitting than I first made it.

What remains is `workspace:*` wiring and build ordering between packages, which is
real but modest at three packages.

### Bundle weight

Worth being concrete, because intuition misleads here.

- The entire collage tool is ~1050 lines of TypeScript — call it 5–6 KB gzipped.
- Vue 3's runtime is roughly 34 KB gzipped.

**Under `TASKS.md`, the framework outweighs the tool logic by roughly six to one** in
every lean app. That is the strongest argument against Vue for the standalone apps,
and it cuts directly against the "small lean and focused" half of the stated goal.

Conversely, the usual objection to buildless — no tree-shaking, so importing
`packages/collage/dist/index.js` drags in all seven layouts plus the 125-line mosaic
template table even if you only render a grid — is **weak at this codebase's scale**.
The whole barrel is smaller than the framework you'd add to avoid it.

### OpenCV

A non-issue under both plans, worth defusing so it doesn't sway the decision.
`core/photo-edit` only does `import type { Mat, CV }`, which erases at compile time,
and treats `cv` as an ambient global supplied by the host page. OpenCV can't end up in
a collage or scale bundle under either plan.

### "Just open the file in a browser"

`AGENTS.md` currently advertises that the mini-apps open directly from disk with no
server. **`fTASKS.md` silently gives this up.** ES modules are fetched under CORS
rules, and `file://` is an opaque origin, so a `<script type="module">` importing
`../../packages/scale/dist/index.js` is blocked in Chrome, Firefox, and Safari alike.
Buildless apps would still need a local HTTP server — they'd just need it *and* a
prior `pnpm -r build`, since `dist/` isn't committed.

This is not fatal, but it means "buildless" doesn't deliver the zero-friction property
it sounds like it delivers, and the plan should be honest about that.

### Managing UI state

This is where Vue earns its 34 KB, and only in one place.

`photo-collage.html` is 1498 lines, most of it manual DOM synchronisation. The scale
app's `renderImages()` rebuilds the entire grid via `innerHTML` on every state change —
twice per image during a batch run. Reactive rendering deletes that whole category of
code and the bugs in it, including the unescaped-filename XSS, which exists precisely
*because* the app builds DOM by string concatenation.

Custom elements encapsulate markup but supply no reactivity. Porting collage to custom
elements keeps all 1498 lines of imperative DOM work; it just puts a boundary around
them. Where `fTASKS.md` is weakest is that it's silent on how collage's state gets
managed.

But note this pain is concentrated: collage is genuinely complex, scale and photo-edit
are not. A framework chosen to fix collage gets paid for in all four apps.

### Migration risk and time-to-value

These plans front-load opposite things.

`fTASKS.md` Phase 1 is a mechanical file move guarded by 88 existing tests — low risk,
probably an hour, near-zero chance of silent breakage. But nothing a user can see
changes until Phase 3.

`TASKS.md` Phase 1 is a UI rewrite with genuine pixel-parity risk (canvas
`imageSmoothingQuality: 'high'` is unspecified and varies by browser and browser
version), but it ships a working, improved app immediately.

### Reversibility — the significant asymmetry

Most of these choices are cheap to reverse. One is not:

- Splitting `core` → recombining: easy, no external consumers exist yet.
- Buildless apps → adding Vite later: easy, custom elements work fine under a bundler.
- **Custom-element UI packages → consumed by a Vue app later: easy.** Vue has
  first-class custom element support; you set `isCustomElement` in the compiler options
  and they just work.
- **Vue SFC UI packages → consumed by a buildless app later: not possible** without
  rewriting them.

So `fTASKS.md`'s UI choice is forward-compatible with `TASKS.md`'s, and not the other
way round. If the UI layer is the part you're least sure about, custom elements are the
option that preserves both futures.

## A hybrid worth considering

Neither plan has to win whole. The decisions are more separable than the two documents
imply:

1. **Split `core` into three packages** (from `fTASKS.md`). Cheap, mechanical, guarded
   by 88 tests, keeps the buildless option alive, and makes the ESLint boundary rule
   redundant. Do it first regardless — it's the lowest-risk step in either plan.
2. **Build shared UI as custom elements** (from `fTASKS.md`). The forward-compatibility
   asymmetry above makes this strictly the safer bet.
3. **Keep scale and photo-edit buildless.** Their logic is small and mostly imperative
   canvas work; a framework is pure overhead there.
4. **Use a framework only where state complexity justifies it** — collage, and later
   studio. This is the one real judgement call, and it can be deferred until collage is
   actually being ported, by which point the custom elements will exist and you'll know
   whether they're sufficient.

The cost of the hybrid is heterogeneity: two kinds of app in one repo, two dev
workflows, and a shared UI layer constrained to the lowest common denominator.

## What to decide

1. Buildless or bundled for the standalone apps? (Everything else follows.)
2. If bundled — is 34 KB of framework acceptable in an app whose logic is 6 KB?
3. If buildless — is losing `file://` opening acceptable, and how does collage's
   1498 lines of DOM sync get managed?
4. Custom elements or framework components for shared UI? (Note the one-way door.)
5. Split `core` now, or leave it? (Answered by #1 unless you take the hybrid.)
6. Sequence: lowest-risk refactor first, or user-visible value first?

## Facts about this repo that bear on the choice

- `packages/core` is 1339 lines total: photo-edit ~190, collage ~1050, scale ~60.
- 88 tests pass today, all in `packages/core`.
- `photo-edit/`'s own test suite has never run in CI — it sat outside the workspace
  globs. Fixed in Phase 0.
- All three mini-apps still carry duplicate copies of the logic already in `core`;
  no app consumes `core` yet. Both plans fix this, at different points.
- `@graphic-quicks/core`'s exports map points only at `./dist`, which isn't committed,
  so a fresh clone can't resolve it until `pnpm -r build` runs. This bites the
  buildless plan harder, since apps reference `dist/` paths directly.
- Deployment is currently `actions/jekyll-build-pages`, which assumes raw static HTML.
  Both plans require replacing it.
