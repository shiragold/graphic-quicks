# Photo Collage Maker

A buildless HTML/JS tool that builds a photo collage from any number of uploaded images. Everything runs locally in the browser. Layout math and EXIF date parsing come from `@graphic-quicks/collage` (`packages/collage/dist`). The app keeps Canvas rendering, file loading, and DOM wiring.

Serve the repo root over HTTP and open `apps/photo-collage/photo-collage.html`:

```bash
pnpm -r build
pnpm serve
# open http://localhost:3000/apps/photo-collage/photo-collage.html
```

## Features

- Drag-and-drop or click-to-browse upload, any number of images, mixed formats (JPEG/PNG/WebP).
- Ordering by EXIF `DateTimeOriginal` via `readExifDate`, falling back to the file's `lastModified`.
- Drag-and-drop reorder of photos in the thumbnail strip.
- Configurable output resolution (default `800 x 1200`), with ratio presets (2:3, 3:2, 1:1, 9:16, 16:9, A4).
- Nine layout modes. Placement is `computeCollageLayout`; each mode is implemented under `packages/collage/src/layouts/`:
  - **Justified rows** and **justified columns** — every photo keeps its aspect ratio. Rows fill the width; columns fill the height.
  - **Grid** — consecutive rows of `columns` photos, row height from the row's aspects, scaled to fit.
  - **Masonry** — shortest-column placement.
  - **Hero + grid** — the first photo is large; the rest sit in a supporting grid. Hero position is start, center, or end.
  - **Mosaic** — fixed templates for 1–9 photos.
  - **Polaroid scatter** — white-framed cards at deterministic positions and rotations.
  - **One row** and **one column** — equal-cell strips.
- Photos are cover-fit into each cell, so modes other than justified rows/columns can crop.
- Adjustable gap, padding, corner radius, column count, and background color.
- Live canvas preview at full output resolution; export as PNG.
