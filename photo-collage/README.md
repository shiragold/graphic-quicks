# Photo Collage Maker

A single-file, dependency-free HTML/JS tool that builds a photo collage from any number of uploaded images. Everything runs locally in the browser -- no server, no upload, no framework, no bundle.

Open `photo-collage.html` directly in a browser.

## Features

- Drag-and-drop or click-to-browse upload, any number of images, mixed formats (JPEG/PNG/WebP).
- **Automatic ordering by photo timestamp** (EXIF `DateTimeOriginal`), with fallback to the file's `lastModified`.
- Drag-and-drop reorder of photos in the thumbnail strip.
- Configurable output resolution (default `800 x 1200`), with one-click ratio presets (2:3, 3:2, 1:1, 9:16, 16:9, A4).
- Five layout modes:
  - **Justified (no crop)** -- default; described in detail below.
  - **Grid (auto)** -- equal-cell grid, photos object-fit-cover (crops to fit).
  - **Columns (masonry)** -- shortest-column placement, vertically scaled to fit.
  - **Single row** / **Single column** -- equal-cell strip layouts.
- Adjustable gap, padding, corner radius, background color.
- Live canvas preview at full output resolution; export as PNG.

## EXIF date extraction

Done inline without any library. The first 256 KB of each JPEG is read via `ArrayBuffer` + `DataView`. We walk the JPEG marker chain to find the `APP1` segment, verify the `"Exif"` magic, parse the TIFF header (handling both little- and big-endian byte order), follow the `ExifOffset` (tag `0x8769`) into the EXIF SubIFD, and read `DateTimeOriginal` (tag `0x9003`) or `DateTimeDigitized` (tag `0x9004`). The string format is `"YYYY:MM:DD HH:MM:SS"`.

If the file is not a JPEG, has no EXIF, or parsing fails, we fall back to `file.lastModified`.

Each upload batch is sorted oldest-first by the resolved date and appended to the photo array.

## The justified layout algorithm

This is the interesting part. The goal is:

> Show every uploaded photo in full -- **no cropping**, **no edge gaps**, on a fixed-size canvas, regardless of the photos' aspect ratios.

For arbitrary mixed-aspect photos and an arbitrary canvas aspect ratio, this is mathematically over-constrained -- you cannot in general have all of:

1. No cropping (every photo keeps its native aspect).
2. No horizontal gaps (rows fill the canvas width exactly).
3. No vertical gaps (rows fill the canvas height exactly).

So we **prioritize "no cropping"** and pick the layout that fills the most canvas area while preserving every aspect ratio. Any leftover space appears as the chosen background color, centered on the canvas.

### Step 1: choose a row count

Photos are placed into consecutive rows in the order shown in the thumbnail strip. The only free parameter is *how many rows* to use (call it `k`).

For each candidate row count `k = 1..N` we ask: "what's the best way to split N photos into `k` consecutive rows?"

### Step 2: optimal partition for a fixed row count (linear partition DP)

Within a row, if photos have aspect ratios `a_1, ..., a_m` (where `a_i = w_i / h_i`) and the row is required to fill canvas width `W` (with gaps `g`), then every photo in that row must share a single height:

```
rowH = (W - (m - 1) * g) / Σ a_i
```

So a row's height is inversely proportional to its summed aspect ratio. Rows with small aspect-sums are tall; rows with large aspect-sums are short.

To get visually balanced rows of similar height, we want partitions where each row's `Σ a_i` is similar -- specifically, we minimize the **maximum** aspect-sum over all rows. This is the classic "linear partition" problem, solved with O(N^2 * k) DP:

```
dp[i][j] = best (= min over partitions) of (max row aspect-sum)
           when placing the first i photos into j rows.
prefix[i] = Σ a_k  for k < i

dp[0][0] = 0
dp[i][1] = prefix[i]                                        for i >= 1
dp[i][j] = min over p in [j-1, i-1] of
              max(dp[p][j-1], prefix[i] - prefix[p])        for j >= 2

parent[i][j] records the argmin p, used to reconstruct row boundaries.
```

The reconstruction yields row break indices `[end_1, end_2, ..., N]`.

### Step 3: score each row count by canvas coverage

Given the partition for row count `k`, compute each row's natural height as above and the total stack height (rows + vertical gaps). Each row already exactly fills width `W`, so the stack has dimensions `W x H_k`.

To fit `W x H_k` inside the canvas `W x H_canvas` while preserving aspect ratios (no cropping), apply a uniform scale:

```
scale_k = min(1, H_canvas / H_k)
covered_area_k = (W * scale_k) * (H_k * scale_k)
coverage_k    = covered_area_k / (W * H_canvas)
```

If the natural stack already fits (`H_k <= H_canvas`), `scale_k = 1` and the canvas has empty space at the top/bottom. If the stack is taller than the canvas, we shrink it uniformly, leaving empty strips on the sides.

We pick the `k` that maximizes `coverage_k`.

### Step 4: emit rectangles

Apply `bestScale` uniformly to row heights, photo widths, and gaps. Center the resulting `(W * bestScale) x (H_best * bestScale)` block within the canvas's content area (after padding). Render each photo into its rect with `object-fit: cover` math (which is a no-op here since rects already match the photos' aspect ratios -- nothing gets cropped).

### Why this works in practice

- For mostly-landscape photos in a portrait canvas: the algorithm picks more rows (e.g. 3-4 short rows) so the stack reaches the canvas height.
- For mostly-portrait photos in a landscape canvas: the algorithm picks fewer rows (e.g. 1-2 tall rows) so wide rows don't push the stack too tall.
- Mixing portrait and landscape photos in one row is fine: the row's height is whatever makes the row's total width equal `W`, so a portrait photo in a row will end up the same height as the landscapes next to it (its width will be small, theirs will be large).

The honest trade-off: there will sometimes be a strip of background color on one axis. The amount of leftover is minimized by the coverage scoring.

### Complexity

O(N^3) overall (N row counts x O(N^2) DP each). Fine for hundreds of photos in real time. The DP tables are small enough that there's no need for more sophisticated algorithms (e.g. Knuth-style optimization).

## Other layouts

For completeness, the other layout modes are simple:

- **Grid**: `cols = min(columnsControl, N)`, `rows = ceil(N / cols)`. Every cell is `((W - (cols-1)g) / cols) x ((H - (rows-1)g) / rows)`. Photos drawn with object-fit-cover (crops).
- **Columns (masonry)**: pre-determined column count `c`. Each photo is placed into the currently-shortest column at width `(W - (c-1)g) / c` and its natural height. After placement, all column heights are scaled uniformly to fit `H` (so the result fills the canvas vertically; photos may be slightly stretched).
- **Row** / **Column**: split the corresponding axis into N equal cells; photos drawn with object-fit-cover.

## Files

- `photo-collage.html` -- the entire tool (HTML + CSS + JS in one file).
- `README.md` -- this document.
