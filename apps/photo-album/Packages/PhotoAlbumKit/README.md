# PhotoAlbumKit

The local SwiftPM package that holds photo-album's logic (see `research/tech-stack.md`,
"Suggested project skeleton"). Module names follow `research/jargon.md`; the dependency
direction is the one listed there.

| Module | Holds |
|---|---|
| `Catalog` | Theme and Template models (`photo-album/theme@1`, `photo-album/template@1`), Tokens and Palettes, Page Format overrides, Optional Slots with Absent Overrides, Bindings; Theme sources (`ThemeSource`, `BundledThemeSource`), the compatibility gate and `ThemeCatalog` |
| `Library` | `Photo`, `PhotoID`, `PhotoSource`, `PhotoKitSource` (Access, fetch by Period, thumbnails, Originals) |
| `Grouping` | `Period`, `PeriodIndex` (months with counts), the transient `Group` |
| `Insights` | `Insight`; `CentreFocusInsights` is a stub for the Vision step |
| `Composition` | The `Book` aggregate (Book Photos, Excluded, Collages, the placed-once invariant), `Placement`, `Fit`, Default Text, `BookStore` (one JSON file per Book) |
| `Suggestion` | `TemplateSuggester` (fits the photo count), the greedy `Matcher`, `FitSuggester`, `CollageMaker` |
| `Rendering` | `CollageRenderer`: one Core Graphics renderer for preview and export; SVG-subset decorations, masks, borders, shadows, text fitting |
| `Export` | PNG (300 DPI, DPI metadata) and PDF (one Collage per page, the Book PDF) |
| `Usage` | The Usage Log, monthly Usage Reports, Preferences and Quick Rating sampling |
| `UI` | SwiftUI flow: Book picker, Book overview, Add Photos (Access → month → Group → Template), Collage preview and export |

## Theme sources and versions

A Theme is identified by `id` + `version` (`ThemeRef`). Collages store it, and Usage
`Variant`s carry `themeVersion`, so a Theme update never silently changes a finished page or
mixes its counts with the older version's.

- `ThemeSource` lists Theme headers and loads bundles. `BundledThemeSource` reads the Themes
  shipped in the app's resources. A hosted catalog (`CatalogThemeSource`: a `catalog.json`,
  with downloads cached in Application Support) is sketched in `ThemeSource.swift` and not built.
- `ThemeCompatibility` is the gate. A Theme must use `photo-album/theme@1`, declare
  `templateFormat: "photo-album/template@1"` and have a numeric `version`. Its optional
  `minAppVersion` must not exceed the app's version. Skipped Themes are logged with the reason
  (subsystem `com.graphicquicks.PhotoAlbum`, category `ThemeCatalog`) and listed in
  `ThemeCatalog.skipped`.
- `ThemeCatalog(sources:)` merges sources. Per Theme ID the newest compatible version wins; on
  a tie, the earlier source. Older compatible versions stay available through
  `bundle(for: ThemeRef)`. Adding a remote source is one more element in `sources`.

The `parity` executable renders every Template × Page Format for the renderer parity check
(`apps/photo-album/parity/README.md`).

Minimum macOS 26, Swift 6 language mode.

## Build and test

```sh
swift build
scripts/test.sh        # = `swift test` when Xcode is selected
```

With Xcode selected, plain `swift test` works. Tests read the Themes from
`apps/photo-album/themes/`. With only the Command Line Tools,
SwiftPM cannot find Swift Testing by itself, and `swift test` fails with
`no such module 'Testing'`. `scripts/test.sh` passes the CLT framework folder in that case.

## Where the files are

Everything goes under `FileManager`'s Application Support folder
(`UsageLocation.standard()`). In the sandboxed app that is the container:

```
~/Library/Containers/<bundle-id>/Data/Library/Application Support/PhotoAlbum/
  UsageLog/usage-log.json      the Usage Log: raw signals and sampler state; app-only
  usage/usage-YYYY-MM.json     Usage Reports, shape of themes/skill/references/usage-report.md
```

The monthly routine reads `…/PhotoAlbum/usage/`.
`UsageLocation.containerReportsDirectory(bundleID:)` builds that path from outside the app.
Without the sandbox (`swift test`, an unsigned debug build) the same code resolves to
`~/Library/Application Support/PhotoAlbum/`.

**Help → Show Usage Data** should reveal `location.reportsDirectory`. For the fallback in
`docs/06` (the user picks a folder once), pass that folder as `reportsDirectory`. The app
keeps the security-scoped bookmark. The log itself stays in the container.

## Adopting it in the app

Create one log at launch and share it:

```swift
let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0"
let usage = try UsageLog.standard(appVersion: version)
```

Every call is `try await usage.record(…)`. Build `Variant`s from Catalog IDs, and build
`CollageRef(collage.id)` from the Collage's own UUID.

| Decision point (Context) | Call |
|---|---|
| Book started with a Page Format (Composition) | `.bookStarted(format:)` |
| Template Suggestions shown (Suggestion) | `.suggestionsShown(variants:)` |
| Template picked for a new Collage (Suggestion) | `.templatePicked(collage:variant:source: .suggestion(position:))` or `source: .search` |
| Change Template, which is also Change Theme when the Theme differs (Composition) | `.templateChanged(collage:from:to:)` |
| Palette set on a Collage (Composition) | `.paletteChosen(collage:variant:)` with the new Palette |
| Remake → Reshuffle (Composition) | `.remade(collage:variant:)` |
| Swap / Replace / Re-fit (Composition) | `.swapped` / `.replaced` / `.refitted(collage:variant:)` |
| Default Text typed over (Composition) | `.textEdited(collage:variant:binding:)`; the Binding only, never the text |
| Accept (Composition) | `.accepted(collage:variant:optionalSlot: .none / .filled / .empty)` |
| Export, per Collage (Export) | `.exported(collage:variant:optionalSlot:)` |
| Remove Collage (Composition) | `.collageRemoved(collage:variant:)` |
| Collage first shown on the results screen | `if try await usage.shouldOfferQuickRating(for:)` → show `.quickRating(isPresented:…)` |
| 👍 / 👎 tapped | `usage.recordQuickRating(_:for:variant:)` |
| Quick Rating closed | `usage.recordQuickRatingDismissed(for:)` |
| Ranking Template Suggestions | `let prefs = try await usage.preferences()` then add `prefs.boost(for: templateRef)` (±0.1 at most) |
| Settings → Reset usage data | `usage.reset()` erases the log, the sampler state and every `usage-*.json` |

Recording saves the log and rewrites the report of every month the signal affects. A
Change Template in November rewrites October's file too if the Collage was kept in
October. No manual export is needed.

## Report rules

- Rows are per Variant (Theme × Template × Page Format × Palette). Rows that are all zero
  are left out. Every Page Format is listed under `variants.format`, including zeros.
- `made` counts picks, Search picks and Change Template targets.
- `kept` counts a Collage once, in the month of its latest Accept or Export, unless a later
  Change Template or Remove Collage happened. `optionalEmpty` comes from that keep.
- `remade` and `textOverridden` count Collages: once per Collage, per Binding.
- `variants.palette` counts Collages that got a non-default Palette, keyed `theme/palette`.
- Only a Collage's first Quick Rating counts.
- A signal's month is fixed in the user's time zone at the moment it is recorded. The time
  zone itself is not stored.

## Quick Rating sampling

Deterministic: `QuickRatingSampler` uses no random generator. It decides once per Collage,
when the Collage is first shown:

1. A Collage that was considered before is never offered again.
2. At least `3 × 2^streak` other Collages must have been considered since the last offer.
3. The Collage is offered if `FNV-1a(UUID) / 2^64 < 0.15 / 2^streak`.

`streak` counts consecutive dismissals, capped at 4. A rating resets it to 0. That gives
about 1 Collage in 10 normally, and fewer than 1 in 100 after four dismissals in a row. The
sampler state is saved with the log and erased by reset.

## Privacy

The types enforce it. Each `UsageSignal` payload is a Catalog ID (`ThemeID`, `TemplateID`,
`PaletteID`), a `PageFormat`, a `TextBinding`, a small enum, an `Int` or a `CollageRef`
(the Collage's UUID). Catalog IDs only accept lowercase slugs (`[a-z0-9-]`, at most 64
characters), both when constructed and when decoded. That rules out PhotoKit identifiers,
paths, prose, coordinates and base64. `PrivacyTests` uses `Mirror` to walk one signal of
every kind and fails on any other stored type. Reports never contain `CollageRef`s.
