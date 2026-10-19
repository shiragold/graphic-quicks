# photo-edit

Browser-based auto-crop / deskew for scanned photos, powered by OpenCV.js.

- UI: [index.html](./index.html)
- Image-processing logic: [`@graphic-quicks/photo-edit`](../../packages/photo-edit/),
  imported directly from its built output
  (`../../packages/photo-edit/dist/index.js`) via `<script type="module">`.

The app itself has no build step, but it loads ES modules over HTTP, so open
it from a local server rather than `file://`. Build the package first, then
serve the repo root:

```bash
pnpm install
pnpm -r build
pnpm serve
# open http://localhost:3000/apps/photo-edit/
```

OpenCV.js is the same `@techstark/opencv-js` 5.x package the tests use.
`index.html` loads `node_modules/@techstark/opencv-js/dist/opencv.js` (installed
with the app) and waits for that build's factory Promise before calling any
package function. That Promise is when the ambient `cv` global becomes available.

## Tests

The test suite lives with the package: `packages/photo-edit/tests/`.

```bash
pnpm --filter @graphic-quicks/photo-edit test
pnpm --filter @graphic-quicks/photo-edit fixtures  # dump fixture PNGs for eyeballing
```
