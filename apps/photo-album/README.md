# Photo Album (macOS)

A native macOS app (Swift 6, SwiftUI, sandboxed, local-only, macOS 26+) that turns Photos into
decorated Collages organised in Books. Vocabulary: `research/jargon.md`; stack:
`research/tech-stack.md`.

This is the walking skeleton. It starts a Book with a Page Format, reads one month of the
Photos Library (full or limited Access), and shows the Group so the user can exclude Photos.
Then the user picks a Template that fits the photo count, the app suggests Placements and
Fits, renders the Collage with Core Graphics, and exports a PNG, a PDF or the Book PDF.

```
PhotoAlbum.xcodeproj     app target only (sandbox + Photos entitlement, usage string)
App/                     @main
PhotoAlbum.entitlements
Packages/PhotoAlbumKit/  all logic (see its README)
themes/                  built-in Theme bundles, copied from research/themes
parity/                  Swift vs reference renderer contact sheets and findings
tools/parity/            stand-in photos and their export script
```

## Build and run

Open `PhotoAlbum.xcodeproj` in Xcode 27 and run, or:

```sh
xcodebuild -project PhotoAlbum.xcodeproj -scheme PhotoAlbum build
```

The app is signed to run locally. Books are saved as JSON in the container's
`Application Support/PhotoAlbum/Books/`.

`-smoke-run [yyyy-MM]` runs the whole flow without clicks, through the same model calls as
the UI. It uses the given month, or the newest month with at least 3 Photos. It writes window
snapshots, `collage.png`, `collage.pdf`, `book.pdf` and `smoke.log` to the container's
`Application Support/PhotoAlbum/SmokeRun/`.
