---
name: select-best-photos
description: Pick the best photos from an Apple Photos album (including iCloud shared albums) by date and content, then export them. Use when the user asks to choose, curate, or pull photos from their Photos library, e.g. "select the best photos from album X around <date> showing <event>".
---

# Select best photos

Uses the `photo-filter` MCP server (`packages/photo-filter`). Tools:
`list_albums`, `query_photos`, `get_thumbnails`, `export_photos`.

If the MCP server is unavailable, the same operations exist as a CLI:
`node packages/photo-filter/dist/cli.js albums|query|thumbs|export --json`
(`thumbs --out DIR` writes JPEGs you can open with the Read tool).

## Preferred: the `curate` pipeline

For a complete request (album + date + brief), run the deterministic
pipeline instead of orchestrating tools yourself. It needs
`OPENROUTER_API_KEY` (default model `typesafe/jev-1.14`). Load it from
`packages/photo-filter/.env` or the environment.

```sh
PHOTO_FILTER_OSXPHOTOS="uvx --python 3.12 osxphotos" \
node --env-file-if-exists=packages/photo-filter/.env \
  packages/photo-filter/dist/cli.js curate --album "Annaelle 4" \
  --from 2025-11-30 --to 2025-12-31 \
  --brief "Annaelle's 3rd birthday party and month thereafter" \
  --subject Annaelle --dest ~/Downloads/annaelle-birthday
```

Default density is ~20 picks per 30 days of the range (`--per-month 20`);
override with `--count N`. Without a terminal it stops after writing
`<dest>/review.html`. Show the user the picks (or the sheet), then re-run
with `--yes`; per-photo verdicts are cached, so a re-run skips judging.
If the user wants some dropped, run without `--yes` in a terminal and
answer e.g. `3,7: too blurry`, which records the feedback for later runs.

Use the manual workflow below when there is no API key, or for interactive
browsing ("show me what's in this album").

## Manual workflow (MCP tools)

1. **Resolve the album.** Call `list_albums` and match the user's name
   case-insensitively; shared albums have `shared: true`. If several match or
   none do, ask instead of guessing.
2. **Query the window.** `query_photos` with `album: [name]`, `around:
   YYYY-MM-DD`, and `days` (default 2; widen to 3-4 if "around" is loose or
   results are thin). Use `sort: "score"`. Note the total count.
3. **Shortlist by metadata.** Drop movies (default), obvious duplicates
   (same second, adjacent filenames), and the low end of `score`. Keep roughly
   3x the number of photos you intend to deliver, capped at ~36.    `score` is a
   hint, not a verdict: never discard photos solely on it when the set is
   small. iCloud shared-album items are never scored (`score: null`), so for
   shared albums skip score ranking and view every candidate (in date order)
   instead.
4. **Look at them.** `get_thumbnails` in batches of up to 12 (size 512 is
   enough to judge). For each photo decide against the user's brief:
   - **Relevance:** does it show the requested subject/event (e.g. the
     birthday girl, cake, party)? Use `persons`/`labels` as supporting
     evidence only; trust what you see.
   - **Quality:** sharp focus on faces, eyes open, good exposure, not
     cropped mid-face, flattering expression.
   - **Variety:** from a burst or near-duplicate group keep the single best;
     cover different moments (arrival, cake, candles, gifts, group shot).
5. **Confirm before exporting** unless the user already gave a destination
   and count. Present the picks as a short list: uuid, time, one-line reason.
6. **Export.** `export_photos` with the chosen uuids and `dest` (default
   suggestion: `~/Downloads/<album>-<date>`). Default `version: "edited"`.
   Set `convertToJpeg: true` if the files are for the browser apps.
   Report the written file paths.

## Failure modes

- **"not found" / permission errors:** the host app (Cursor or the terminal)
  needs Full Disk Access in System Settings > Privacy & Security, then a
  restart of the app.
- **osxphotos missing:** the server runs `PHOTO_FILTER_OSXPHOTOS` (default in
  `.cursor/mcp.json`: `uvx --python 3.12 osxphotos`); `brew install uv` fixes it.
- **"iCloud-only" thumbnail error:** no local preview exists; skip the photo
  for viewing or export it with `downloadMissing: true` (slow, opens Photos).
- **Shared albums** hold reduced-resolution copies; say so if the user needs
  print quality.
